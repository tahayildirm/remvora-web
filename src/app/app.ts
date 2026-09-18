import { loadView, saveView } from './view-preferences';
import { SurfaceGestures } from './surface-gestures';
import { InputMode, TouchPointer, touchLayout } from './touch-pointer';
import { COUNTRY_CODES, TURKEY_PROVINCES } from './location-data';
import { DEFAULT_QUALITY, VideoQuality, loadQuality, saveQuality } from './video-quality';
import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  computed,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api, Device, Identity } from './api';
import { I18n } from './i18n';
import { Remote } from './remote';
import type { Terminal } from '@xterm/xterm';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, OnDestroy {
  api = inject(Api);
  private changes = inject(ChangeDetectorRef);
  i18n = inject(I18n);
  remote = inject(Remote);
  me = signal<Identity | null>(null);
  devices = signal<Device[]>([]);
  sessions = signal<{ id: string; expiresAt: string; current: boolean }[]>([]);
  page = signal(0);
  pageSize = 100;
  section = signal('devices');
  search = signal('');
  error = signal('');
  notice = signal('');
  rebootDevice: Device | null = null;
  rebootConfirmation = '';
  beginReboot(device: Device) {
    this.rebootDevice = device;
    this.rebootConfirmation = '';
    this.modal.set('reboot');
  }
  async requestReboot() {
    await this.run(async () => {
      if (!this.rebootDevice) return;
      await this.api.request('devices/' + this.rebootDevice.id + '/reboot', 'POST', {
        deviceCode: this.rebootConfirmation,
      });
      this.modal.set('');
      this.notice.set(this.t('rebootRequested'));
    });
  }
  busy = signal(false);
  rows = signal<Record<string, unknown>[]>([]);
  nav = [
    'devices',
    'groups',
    'tags',
    'contacts',
    'locations',
    'keys',
    'users',
    'audit',
    'security',
  ];
  profileOpen = signal(false);
  profileEmail = '';
  profileRole = '';
  organizationName = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  organizationCode = '';
  organizations = signal<{ id: string; name: string }[]>([]);
  selectedOrganization = '';
  async openProfile() {
    await this.run(async () => {
      const profile = await this.api.request<{
        email: string;
        role: string;
        organizationName: string;
      }>('auth/profile');
      this.profileEmail = profile.email;
      this.profileRole = profile.role;
      this.organizationName = profile.organizationName;
      this.currentPassword = this.newPassword = this.confirmPassword = this.organizationCode = '';
      this.organizations.set([]);
      this.selectedOrganization = this.me()?.organizationId ?? '';
      this.profileOpen.set(true);
    });
  }
  closeProfile() {
    this.profileOpen.set(false);
    this.currentPassword = this.newPassword = this.confirmPassword = this.organizationCode = '';
    this.organizations.set([]);
  }
  async saveProfile() {
    if (this.newPassword !== this.confirmPassword) {
      this.error.set(this.t('passwordMismatch'));
      return;
    }
    await this.run(async () => {
      await this.api.request('auth/profile', 'PUT', {
        email: this.profileEmail,
        currentPassword: this.currentPassword,
        newPassword: this.newPassword || null,
      });
      this.email = this.profileEmail;
      this.closeProfile();
      this.notice.set(this.t('profileSaved'));
    });
  }
  async findOrganizations() {
    await this.run(async () => {
      this.organizations.set(
        await this.api.request('auth/organizations', 'POST', { password: this.currentPassword }),
      );
    });
  }
  async switchOrganization() {
    await this.run(async () => {
      const profile = await this.api.request<{ email: string }>('auth/profile');
      await this.api.request('auth/login', 'POST', {
        organizationId: this.selectedOrganization,
        email: profile.email,
        password: this.currentPassword,
        code: this.organizationCode || null,
      });
      this.close();
      this.closeProfile();
      this.devices.set([]);
      this.rows.set([]);
      this.sessions.set([]);
      this.page.set(0);
      this.me.set(await this.api.request<Identity>('auth/me'));
      this.section.set('devices');
      await this.load();
    });
  }
  email = '';
  password = '';
  code = '';
  deviceName = '';
  description = '';
  modal = signal('');
  secret = signal('');
  totpSecret = signal('');
  recovery = signal<string[]>([]);
  keyName = '';
  keyScopes = ['devices.read'];
  remoteStatus = signal('');
  remoteKind = '';
  selectedName = '';
  clipboardText = '';
  displays: { id: number; name: string }[] = [];
  selectedDisplay = '';
  listDisplays() {
    this.remote.displaysReceived = (displays) => {
      this.displays = displays;
      this.changes.markForCheck();
    };
    this.remote.control({ type: 'display.list' });
  }
  selectDisplay() {
    this.releaseDesktopKeys();
    this.remote.control({ type: 'display.select', monitor_id: Number(this.selectedDisplay) });
  }
  private readonly savedView = loadView();
  terminalFontSize = this.savedView.fontSize;
  audioMuted = this.savedView.muted;
  audioVolume = this.savedView.volume;
  private fitTerminal?: () => void;
  private saveViewPreferences() {
    if (
      !saveView({
        fontSize: this.terminalFontSize,
        muted: this.audioMuted,
        volume: this.audioVolume,
      })
    )
      this.error.set(this.t('viewStorageFailed'));
  }
  setTerminalFontSize(value: number) {
    if (!Number.isInteger(value) || value < 8 || value > 24) return;
    this.terminalFontSize = value;
    if (this.terminal) this.terminal.options.fontSize = value;
    this.fitTerminal?.();
    this.saveViewPreferences();
  }
  fileStatus = signal('');
  async uploadFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    this.remote.files.changed = () => this.changes.markForCheck();
    await this.run(async () => {
      for (const file of Array.from(files)) {
        this.fileStatus.set(file.name);
        await this.remote.files.upload(file);
      }
      this.fileStatus.set(this.t('fileComplete'));
      await this.remote.files.list();
    });
  }
  async listFiles() {
    this.remote.files.changed = () => this.changes.markForCheck();
    await this.run(() => this.remote.files.list());
  }
  async downloadFile(file: { name: string; size: number }) {
    this.remote.files.changed = () => this.changes.markForCheck();
    await this.run(async () => {
      const blob = await this.remote.files.download(file);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }
  async cancelFiles() {
    await this.run(() => this.remote.files.cancel());
  }
  desktopDrop(event: DragEvent) {
    event.preventDefault();
    void this.uploadFiles(event.dataTransfer?.files ?? null);
  }
  desktopPaste(event: ClipboardEvent) {
    event.preventDefault();
    if (event.clipboardData?.files.length) {
      void this.uploadFiles(event.clipboardData.files);
      return;
    }
    this.pasteRemoteText(event.clipboardData?.getData('text/plain') ?? '');
  }
  private pasteRemoteText(text: string) {
    const value = { type: 'clipboard.paste', text };
    if (
      new TextEncoder().encode(text).length > 16384 ||
      new TextEncoder().encode(JSON.stringify(value)).length > 20000
    ) {
      this.error.set(this.t('clipboardTooLarge'));
      return;
    }
    this.remote.control(value);
  }
  async pasteLocalClipboard() {
    await this.run(async () => {
      try {
        this.pasteRemoteText(await navigator.clipboard.readText());
      } catch {
        throw new Error('clipboardPermission');
      }
    });
  }
  async copyRemoteClipboard(command = 'clipboard.read') {
    this.remote.clipboardReceived = (text) => {
      this.clipboardText = text;
      this.changes.markForCheck();
      if (navigator.clipboard)
        void navigator.clipboard
          .writeText(text)
          .catch(() => this.error.set(this.t('clipboardPermission')));
      else this.error.set(this.t('clipboardPermission'));
    };
    this.remote.control({ type: command });
  }
  releaseDesktopKeys() {
    if (this.touch) this.touch.held = false;
    this.remote.control({ type: 'releaseAll' });
  }
  sendShortcut(keys: string[]) {
    this.releaseDesktopKeys();
    for (const key of keys) this.remote.control({ type: 'keyDown', key });
    for (const key of [...keys].reverse()) this.remote.control({ type: 'keyUp', key });
  }
  setAudio() {
    this.saveViewPreferences();
    this.applyAudio();
  }
  private applyAudio() {
    // Autoplay restrictions are retried by the audio control without a global error banner.
    if (!this.audioMuted) void this.remote.resumeAudio()?.catch(() => {});
    const video = document.getElementById('desktop-video') as HTMLVideoElement | null;
    if (video) {
      video.muted = this.audioMuted;
      video.volume = this.audioVolume;
      void video.play().catch(() => {});
    }
  }

  requestClipboard() {
    this.remote.clipboardReceived = (text) => {
      this.clipboardText = text;
      this.changes.markForCheck();
    };
    this.remote.control({ type: 'clipboard.read' });
  }
  sendClipboard() {
    if (
      new TextEncoder().encode(this.clipboardText).length > 16384 ||
      new TextEncoder().encode(JSON.stringify({ type: 'clipboard', text: this.clipboardText }))
        .length > 20000
    ) {
      this.error.set(this.t('clipboardTooLarge'));
      return;
    }
    this.remote.control({ type: 'clipboard', text: this.clipboardText });
    this.clipboardText = '';
    this.managedUserPassword = '';
  }
  catalog: Record<string, string> = {};
  private terminal?: Terminal;
  private resizeObserver?: ResizeObserver;
  private refreshTimer?: ReturnType<typeof setInterval>;
  editId = '';
  userEmail = '';
  userPassword = '';
  userRole = 'Viewer';
  roleName = '';
  rolePermissions: string[] = [];
  availablePermissions: string[] = [];
  scopeUser = '';
  scopeRestricted = false;
  scopeSelected: string[] = [];
  scopeGroups: { id: string; name: string }[] = [];
  navigation() {
    if (this.me()?.deviceGroups != null) return ['devices', 'security'];
    return this.nav.filter((item) =>
      item === 'users'
        ? this.can('users.manage')
        : item === 'keys'
          ? this.can('apiKeys.manage')
          : item === 'audit'
            ? this.can('audit.view')
            : true,
    );
  }
  async editScope(user: Record<string, unknown>) {
    await this.run(async () => {
      this.scopeUser = String(user['id']);
      this.scopeRestricted = user['deviceGroupScope'] != null;
      this.scopeSelected = this.scopeRestricted ? JSON.parse(String(user['deviceGroupScope'])) : [];
      this.scopeGroups = await this.api.all<{ id: string; name: string }>('catalog/groups');
      this.modal.set('scope');
    });
  }
  async saveScope() {
    await this.run(async () => {
      await this.api.request('users/' + this.scopeUser + '/device-groups', 'PUT', {
        groupIds: this.scopeRestricted ? this.scopeSelected : null,
      });
      this.modal.set('');
      await this.load();
    });
  }
  roleNames = ['Owner', 'Admin', 'Operator', 'Viewer'];
  assignment = {
    locationId: null as string | null,
    primaryContactId: null as string | null,
    tags: [] as string[],
    groups: [] as string[],
    contacts: [] as string[],
  };
  catalogs: Record<string, Record<string, unknown>[]> = {};
  filtered = computed(() =>
    this.devices().filter((x) =>
      (x.name + ' ' + (x.operatingSystem ?? ''))
        .toLowerCase()
        .includes(this.search().toLowerCase()),
    ),
  );
  presence = signal<
    Record<string, { online: boolean; busy: boolean; lastSignalAt: string | null }>
  >({});
  private presenceTimer?: ReturnType<typeof setInterval>;
  private presenceLoading = false;
  active = computed(() => this.devices().filter((x) => this.presence()[x.id]?.online).length);
  connectionLabel(device: Device) {
    const state = this.presence()[device.id];
    return !state
      ? 'presenceUnknown'
      : !state.online
        ? 'presenceOffline'
        : state.busy
          ? 'presenceBusy'
          : 'presenceOnline';
  }
  async refreshPresence() {
    if (!this.me() || this.section() !== 'devices' || this.presenceLoading) return;
    this.presenceLoading = true;
    const page = this.page();
    const identity = this.me();
    try {
      const states = await this.api.request<
        { id: string; presence: { online: boolean; busy: boolean; lastSignalAt: string | null } }[]
      >(`devices/presence?offset=${page * this.pageSize}&limit=${this.pageSize}`);
      if (this.me() === identity && this.page() === page)
        this.presence.set(Object.fromEntries(states.map((x) => [x.id, x.presence])));
    } catch {
      this.presence.set({});
    } finally {
      this.presenceLoading = false;
    }
  }
  pending = computed(
    () => this.devices().filter((x) => x.enrollmentStatus === 'PendingActivation').length,
  );
  t(key: string) {
    return this.i18n.t(key);
  }
  can(permission: string) {
    return this.me()?.permissions.includes(permission) ?? false;
  }
  async ngOnInit() {
    try {
      const mode = window.localStorage.getItem('remvora.input-mode');
      if (mode === 'auto' || mode === 'touch' || mode === 'touchpad' || mode === 'mouse')
        this.inputMode.set(mode);
    } catch {
      /* Use automatic mode. */
    }
    this.updateInputLayout();
    window.addEventListener('resize', this.updateInputLayout);
    window.visualViewport?.addEventListener('resize', this.updateInputLayout);
    this.inputMedia?.addEventListener('change', this.updateInputLayout);
    try {
      this.me.set(await this.api.request<Identity>('auth/me'));
      await this.load();
    } catch {
      this.me.set(null);
    }
    this.presenceTimer = setInterval(() => void this.refreshPresence(), 10000);
    this.refreshTimer = setInterval(
      () => {
        if (this.me())
          void this.api.request('auth/refresh', 'POST').catch(() => {
            this.me.set(null);
            this.remote.close();
          });
      },
      30 * 60 * 1000,
    );
  }
  ngOnDestroy() {
    window.removeEventListener('resize', this.updateInputLayout);
    window.visualViewport?.removeEventListener('resize', this.updateInputLayout);
    this.inputMedia?.removeEventListener('change', this.updateInputLayout);
    clearInterval(this.refreshTimer);
    clearInterval(this.presenceTimer);
    this.close();
  }
  async run(action: () => Promise<void>) {
    this.error.set('');
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      const code = e instanceof Error ? e.message : 'REQUEST_FAILED';
      this.error.set(this.t(code));
      if (code === 'UNAUTHORIZED') this.me.set(null);
    } finally {
      this.busy.set(false);
    }
  }
  async login() {
    this.email = this.email.trim();
    if (!this.email || !this.password) {
      this.error.set(this.t('LOGIN_REQUIRED'));
      return;
    }
    await this.run(async () => {
      await this.api.request('auth/login', 'POST', {
        email: this.email,
        password: this.password,
        code: this.code || null,
      });
      this.password = '';
      this.code = '';
      this.me.set(await this.api.request<Identity>('auth/me'));
      await this.load();
    });
  }
  async logout() {
    await this.run(async () => {
      await this.api.request('auth/logout', 'POST');
      this.close();
      this.closeProfile();
      this.me.set(null);
      this.devices.set([]);
    });
  }
  async load() {
    if (this.section() === 'devices') {
      this.presence.set({});
      this.devices.set(
        await this.api.request<Device[]>(
          `devices?offset=${this.page() * this.pageSize}&limit=${this.pageSize}`,
        ),
      );
      await this.refreshPresence();
    } else if (this.section() === 'audit')
      this.rows.set(
        await this.api.request<Record<string, unknown>[]>(
          `audit?offset=${this.page() * this.pageSize}&limit=${this.pageSize}`,
        ),
      );
    else if (this.section() === 'users') {
      this.rows.set(
        await this.api.request<Record<string, unknown>[]>(
          `users?offset=${this.page() * this.pageSize}&limit=${this.pageSize}`,
        ),
      );
      const roles = await this.api.request<{ custom: { name: string }[]; permissions: string[] }>(
        'roles',
      );
      this.roleNames = ['Owner', 'Admin', 'Operator', 'Viewer', ...roles.custom.map((x) => x.name)];
      this.availablePermissions = roles.permissions;
    } else if (this.section() === 'keys')
      this.rows.set(
        await this.api.request<Record<string, unknown>[]>(
          `api-keys?offset=${this.page() * this.pageSize}&limit=${this.pageSize}`,
        ),
      );
    else if (this.section() === 'security')
      this.sessions.set(await this.api.request('auth/sessions'));
    else if (this.section() !== 'security')
      this.rows.set(
        await this.api.request<Record<string, unknown>[]>(
          `catalog/${this.section()}?offset=${this.page() * this.pageSize}&limit=${this.pageSize}`,
        ),
      );
  }
  async navigate(section: string) {
    this.page.set(0);
    this.section.set(section);
    this.rows.set([]);
    await this.run(() => this.load());
  }
  async changePage(delta: number) {
    await this.run(async () => {
      this.page.update((x) => Math.max(0, x + delta));
      await this.load();
    });
  }
  async revokeSession(id: string, current: boolean) {
    await this.run(async () => {
      await this.api.request('auth/sessions/' + id, 'DELETE');
      if (current) {
        this.close();
        this.me.set(null);
        this.sessions.set([]);
      } else await this.load();
    });
  }
  terminalPolicyDevice: Device | null = null;
  terminalPolicyAllowed = false;
  openTerminalPolicy(device: Device) {
    this.terminalPolicyDevice = device;
    this.terminalPolicyAllowed = device.allowTerminalPrivilegeEscalation ?? false;
    this.modal.set('terminalPolicy');
  }
  async saveTerminalPolicy() {
    await this.run(async () => {
      if (!this.terminalPolicyDevice) return;
      await this.api.request(
        'devices/' + this.terminalPolicyDevice.id + '/terminal-policy',
        'PUT',
        {
          allowPrivilegeEscalation: this.terminalPolicyAllowed,
        },
      );
      this.modal.set('');
      await this.load();
    });
  }
  async toggleDevice(device: Device) {
    await this.run(async () => {
      await this.api.request('devices/' + device.id + '/status', 'PATCH', {
        enabled: device.enrollmentStatus === 'Disabled',
      });
      await this.load();
    });
  }
  async create() {
    await this.run(async () => {
      await this.api.request(
        'devices' + (this.editId ? '/' + this.editId : ''),
        this.editId ? 'PATCH' : 'POST',
        { name: this.deviceName, description: this.description || null },
      );
      this.editId = '';
      this.modal.set('');
      this.deviceName = '';
      this.description = '';
      await this.load();
    });
  }
  edit(device: Device) {
    this.editId = device.id;
    this.deviceName = device.name;
    this.description = device.description ?? '';
    this.modal.set('create');
  }
  async assignments(device: Device) {
    await this.run(async () => {
      this.editId = device.id;
      const kinds = ['groups', 'tags', 'contacts', 'locations'];
      const entries = await Promise.all(
        kinds.map((kind) => this.api.all<Record<string, unknown>>('catalog/' + kind)),
      );
      kinds.forEach((kind, index) => (this.catalogs[kind] = entries[index]));
      const links = await this.api.request<Record<string, string>[]>(
        'devices/' + device.id + '/assignments',
      );
      this.assignment = {
        locationId: (device as Device & { locationId: string | null }).locationId,
        primaryContactId: (device as Device & { primaryContactId: string | null }).primaryContactId,
        tags: links.map((x) => x['tagId']).filter(Boolean),
        groups: links.map((x) => x['groupId']).filter(Boolean),
        contacts: links.map((x) => x['contactId']).filter(Boolean),
      };
      this.modal.set('assignments');
    });
  }
  async saveAssignments() {
    await this.run(async () => {
      await this.api.request('devices/' + this.editId + '/assignments', 'PUT', this.assignment);
      this.editId = '';
      this.modal.set('');
      await this.load();
    });
  }
  async createUser() {
    await this.run(async () => {
      await this.api.request('users', 'POST', {
        email: this.userEmail,
        password: this.userPassword,
        role: this.userRole,
      });
      this.userPassword = '';
      this.userEmail = '';
      await this.load();
    });
  }
  async changeRole(row: Record<string, unknown>, role: string) {
    await this.run(async () => {
      await this.api.request('users/' + row['id'] + '/role', 'PATCH', { role });
      await this.load();
    });
  }
  async createRole() {
    await this.run(async () => {
      await this.api.request('roles', 'POST', {
        name: this.roleName,
        permissions: this.rolePermissions,
      });
      this.roleName = '';
      this.rolePermissions = [];
      await this.load();
    });
  }
  async enroll(device: Device) {
    await this.run(async () => {
      const result = await this.api.request<{ token: string }>(
        'devices/' + device.id + '/enrollment',
        'POST',
      );
      this.secret.set(result.token);
      this.modal.set('secret');
    });
  }
  async approve(device: Device) {
    await this.run(async () => {
      await this.api.request('devices/' + device.id + '/approve', 'POST');
      await this.load();
    });
  }
  async deletePermanently(device: Device) {
    if (this.busy()) return;
    const identity = device.name + ' (' + device.deviceCode + ')';
    if (!confirm(this.t('deleteDeviceConfirm') + '\n\n' + identity)) return;
    if (!confirm(this.t('deleteDeviceFinalConfirm') + '\n\n' + identity)) return;
    await this.run(async () => {
      await this.api.request('devices/' + device.id + '/delete-permanently', 'POST', {
        confirmation: device.deviceCode,
      });
      await this.load();
    });
  }
  async revoke(device: Device) {
    if (!confirm(this.t('revoke') + ' ' + device.name + '?')) return;
    await this.run(async () => {
      await this.api.request('devices/' + device.id, 'DELETE');
      await this.load();
    });
  }
  inputMode = signal<InputMode>('auto');
  touchUi = signal(false);
  viewportHeight = signal(window.visualViewport?.height ?? window.innerHeight);
  touch = new TouchPointer((value) => this.remote.control(value));
  viewZoom = signal(1);
  viewPan = signal({ x: 0, y: 0 });
  gestures = new SurfaceGestures(
    (value) => this.remote.control(value),
    this.touch,
    () => ({ zoom: this.viewZoom(), ...this.viewPan() }),
    (v) => {
      this.viewZoom.set(v.zoom);
      this.viewPan.set({ x: v.x, y: v.y });
    },
    () => this.inputMode() === 'touchpad',
  );
  mobileText = '';
  mobileCtrl = false;
  mobileAlt = false;
  keyboardVisible = signal(false);
  autoKeyboardEnabled = signal(true);
  toggleAutoKeyboard() {
    this.autoKeyboardEnabled.update((enabled) => !enabled);
    if (!this.autoKeyboardEnabled()) {
      this.remote.cancelTextFocus();
      (document.getElementById('desktop-keyboard-input') as HTMLTextAreaElement | null)?.blur();
    }
  }
  private readonly inputMedia = window.matchMedia?.('(pointer: coarse)');
  private readonly updateInputLayout = () => {
    this.touchUi.set(
      touchLayout(this.inputMode(), this.inputMedia?.matches ?? false, window.innerWidth),
    );
    this.viewportHeight.set(window.visualViewport?.height ?? window.innerHeight);
    if (this.terminal) this.terminal.options.fontSize = this.terminalFontSize;
  };
  pointerPosition(axis: 'x' | 'y') {
    const video = document.getElementById('desktop-video') as HTMLVideoElement | null;
    if (!video) return 0;
    const w = video.clientWidth,
      h = video.clientHeight;
    const scale = Math.min(w / (video.videoWidth || w), h / (video.videoHeight || h));
    const iw = (video.videoWidth || w) * scale,
      ih = (video.videoHeight || h) * scale;
    return axis === 'x'
      ? w / 2 + ((w - iw) / 2 + this.touch.x * iw - w / 2) * this.viewZoom() + this.viewPan().x
      : h / 2 + ((h - ih) / 2 + this.touch.y * ih - h / 2) * this.viewZoom() + this.viewPan().y;
  }
  setInputMode(mode: InputMode) {
    this.cancelTouch();
    this.inputMode.set(mode);
    try {
      window.localStorage.setItem('remvora.input-mode', mode);
    } catch {
      /* Session preference remains usable. */
    }
    this.updateInputLayout();
  }
  cancelTouch() {
    this.remote.cancelTextFocus();
    this.gestures.cancel();
  }
  touchPointer(event: PointerEvent, type: string) {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const video = document.getElementById('desktop-video') as HTMLVideoElement | null;
    if (!video?.videoWidth || !video.videoHeight) return;
    const p = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const box = {
      width: rect.width,
      height: rect.height,
      imageWidth: video.videoWidth,
      imageHeight: video.videoHeight,
    };
    if (type === 'down') {
      this.remote.cancelTextFocus();
      target.setPointerCapture(event.pointerId);
      this.gestures.down(event.pointerId, p);
    }
    if (type === 'move') this.gestures.move(event.pointerId, p, box);
    if (type === 'up') {
      const tapped = this.gestures.up(event.pointerId, p, box);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      // Open synchronously in the tap gesture; do not wait for remote metadata.
      if (tapped && this.autoKeyboardEnabled()) this.openMobileKeyboard();
    }
  }
  keyLabel(key: string) {
    return (
      (
        {
          Escape: 'Esc',
          ArrowLeft: '←',
          ArrowUp: '↑',
          ArrowDown: '↓',
          ArrowRight: '→',
          Backspace: '⌫',
          Enter: '↵',
        } as Record<string, string>
      )[key] ?? key
    );
  }
  mobileKey(key: string) {
    if (this.remoteKind === 'Terminal') {
      const sequences: Record<string, string> = {
        Enter: '\r',
        Tab: '\t',
        Escape: '\x1b',
        Backspace: '\x7f',
        ArrowUp: '\x1b[A',
        ArrowDown: '\x1b[B',
        ArrowRight: '\x1b[C',
        ArrowLeft: '\x1b[D',
      };
      let value = sequences[key] ?? key;
      if (this.mobileCtrl && /^[a-z]$/i.test(key))
        value = String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64);
      if (this.mobileAlt) value = '\x1b' + value;
      this.remote.input(new TextEncoder().encode(value));
    } else
      this.sendShortcut([
        ...(this.mobileCtrl ? ['Control'] : []),
        ...(this.mobileAlt ? ['Alt'] : []),
        key,
      ]);
    this.mobileCtrl = this.mobileAlt = false;
  }
  sendMobileText() {
    if (!this.mobileText) return;
    if (this.remoteKind === 'Terminal')
      this.remote.input(new TextEncoder().encode(this.mobileText));
    else this.pasteRemoteText(this.mobileText);
    this.mobileText = '';
  }
  showMobileKeyboard() {
    this.cancelTouch();
    this.desktopPanel.set('');
    this.keyboardVisible.update((value) => !value);
    if (this.keyboardVisible()) {
      this.changes.detectChanges();
      this.openMobileKeyboard();
    }
  }
  openMobileKeyboard() {
    // Focus the invisible native input directly during a keyboard action or confirmed text-field tap.
    if (this.remoteKind === 'Terminal') {
      this.terminal?.focus();
      return;
    }
    const input = document.getElementById('desktop-keyboard-input') as HTMLTextAreaElement | null;
    if (!input) return;
    // Android can dismiss the IME while keeping this element focused.
    // A fresh focus transition in the user's gesture is required to reopen it.
    if (document.activeElement === input) input.blur();
    input.value = ' ';
    input.focus({ preventScroll: true });
    input.setSelectionRange(1, 1);
  }
  directKeyboardInput(event: Event) {
    if ((event as InputEvent).isComposing) return;
    const input = event.target as HTMLTextAreaElement;
    const kind = (event as InputEvent).inputType ?? '';
    if (kind.startsWith('delete') || input.value === '') this.mobileKey('Backspace');
    else {
      const text = input.value.startsWith(' ') ? input.value.slice(1) : input.value;
      for (const character of text) this.mobileKey(character === '\n' ? 'Enter' : character);
    }
    input.value = ' ';
    input.setSelectionRange(1, 1);
  }
  directKeyboardKey(event: KeyboardEvent) {
    if (event.isComposing || event.key === 'Process') return;
    if (
      [
        'Backspace',
        'Delete',
        'Enter',
        'Tab',
        'Escape',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(event.key)
    ) {
      event.preventDefault();
      this.mobileKey(event.key);
    }
  }
  desktopToolsVisible = signal(true);
  desktopPanel = signal('');
  desktopFullscreen = signal(false);
  readonly desktopToolTabs = [
    { key: 'quality', label: 'videoQuality', icon: '◈' },
    { key: 'controls', label: 'desktopControls', icon: '⌘' },
    { key: 'files', label: 'desktopFiles', icon: '⇄' },
    { key: 'info', label: 'desktopInfo', icon: 'ⓘ' },
  ];
  desktopPanelTitle = computed(
    () => this.desktopToolTabs.find((t) => t.key === this.desktopPanel())?.label ?? 'desktopTools',
  );
  toggleDesktopTools() {
    this.cancelTouch();
    this.desktopToolsVisible.update((value) => !value);
    if (!this.desktopToolsVisible()) {
      this.desktopPanel.set('');
      this.keyboardVisible.set(false);
    }
  }
  selectDesktopPanel(panel: string) {
    this.cancelTouch();
    this.keyboardVisible.set(false);
    this.desktopPanel.update((current) => (current === panel ? '' : panel));
  }
  syncFullscreen() {
    this.desktopFullscreen.set(
      ['desktop-stage', 'terminal-stage'].includes(document.fullscreenElement?.id ?? ''),
    );
    this.releaseDesktopKeys();
  }
  async toggleDesktopFullscreen() {
    this.releaseDesktopKeys();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const stage = document.getElementById(
          this.remoteKind === 'Terminal' ? 'terminal-stage' : 'desktop-stage',
        );
        if (!stage?.requestFullscreen) throw new Error('Fullscreen unavailable');
        await stage.requestFullscreen({ navigationUI: 'hide' });
      }
      this.syncFullscreen();
      if (this.touchUi()) {
        this.desktopToolsVisible.set(false);
        this.desktopPanel.set('');
        this.keyboardVisible.set(false);
      }
    } catch {
      this.error.set(this.t('fullscreenUnavailable'));
    }
  }
  videoQuality: VideoQuality = { ...DEFAULT_QUALITY };
  private remoteDevice = '';
  saveVideoQuality() {
    if (!saveQuality(this.remoteDevice, this.videoQuality))
      this.error.set(this.t('qualityStorageFailed'));
    this.remote.setQuality(this.videoQuality);
  }
  connectionMode: 'auto' | 'relay' = 'auto';
  async openRemote(device: Device, kind: 'Terminal' | 'Desktop') {
    this.updateInputLayout();
    this.viewZoom.set(1);
    this.viewPan.set({ x: 0, y: 0 });
    this.keyboardVisible.set(false);
    this.mobileText = '';
    this.desktopToolsVisible.set(!this.touchUi());
    this.desktopPanel.set('');
    this.desktopFullscreen.set(false);
    this.remoteDevice = device.id;
    this.videoQuality = loadQuality(device.id);
    this.selectedName = device.name;
    this.remoteKind = kind;
    this.remoteStatus.set('');
    this.remote.connectionPhase.set('connectionAuthorizing');
    this.modal.set('remote');
    await new Promise((resolve) => setTimeout(resolve));
    const host = document.getElementById('terminal');
    if (kind === 'Terminal' && host) {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      this.terminal = new Terminal({
        theme: { background: '#101a27' },
        cursorBlink: true,
        fontSize: this.terminalFontSize,
        disableStdin: false,
      });
      const fit = new FitAddon();
      this.terminal.loadAddon(fit);
      this.terminal.open(host);
      fit.fit();
      this.terminal.onData((data) => this.remote.input(new TextEncoder().encode(data)));
      this.fitTerminal = () => {
        fit.fit();
        this.remote.control({
          type: 'resize',
          cols: this.terminal?.cols,
          rows: this.terminal?.rows,
        });
      };
      this.resizeObserver = new ResizeObserver(this.fitTerminal);
      this.resizeObserver.observe(host);
    }
    this.remote.textDetectionEnabled = false;
    await this.run(() =>
      this.remote.connect(
        device.id,
        kind,
        (code) =>
          this.remoteStatus.set(
            ['connected', 'connectedRelay', 'connecting', 'connectingRelay'].includes(code)
              ? ''
              : this.t(code),
          ),
        (bytes) => this.terminal?.write(bytes),
        (stream) => {
          const video = document.getElementById('desktop-video') as HTMLVideoElement | null;
          if (video) {
            video.srcObject = stream;
            this.applyAudio();
          }
        },
        this.connectionMode,
        this.videoQuality,
      ),
    );
  }
  private lastPointer = 0;
  desktopPointer(event: PointerEvent, type: string) {
    if (event.pointerType === 'touch' && this.touchUi()) {
      this.touchPointer(event, type);
      return;
    }
    const video = event.currentTarget as HTMLVideoElement;
    if (!video.videoWidth || !video.videoHeight) return;
    if (type === 'down') {
      video.focus();
      video.setPointerCapture(event.pointerId);
    }
    if (type === 'up' && video.hasPointerCapture(event.pointerId))
      video.releasePointerCapture(event.pointerId);
    const now = performance.now();
    if (type === 'move' && now - this.lastPointer < 33) return;
    this.lastPointer = now;
    const box = video.getBoundingClientRect();
    const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const width = video.videoWidth * scale,
      height = video.videoHeight * scale;
    const x = (event.clientX - box.left - (box.width - width) / 2) / width;
    const y = (event.clientY - box.top - (box.height - height) / 2) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      // Captured releases outside the image must still release the remote button.
      if (type === 'up') this.remote.control({ type, button: event.button });
      return;
    }
    // Clicks include an ordered move so throttled motion cannot click a stale position.
    this.remote.control({ type: 'move', x, y });
    if (type !== 'move') this.remote.control({ type, button: event.button });
  }
  desktopScroll(event: WheelEvent) {
    event.preventDefault();
    this.remote.control({ type: 'scroll', delta: Math.sign(event.deltaY) * 3 });
  }
  desktopKey(event: KeyboardEvent, type: string) {
    if ((event.ctrlKey || event.metaKey) && ['c', 'x'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (type === 'keyDown' && !event.repeat)
        void this.copyRemoteClipboard(
          event.key.toLowerCase() === 'x' ? 'clipboard.cut' : 'clipboard.copy',
        );
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      // Let the browser dispatch a trusted paste event carrying text/files.
      if (type === 'keyDown') this.releaseDesktopKeys();
      return;
    }
    event.preventDefault();
    this.remote.control({ type, key: event.key });
  }
  close() {
    this.cancelTouch();
    this.mobileCtrl = this.mobileAlt = false;
    this.mobileText = '';
    if (['desktop-stage', 'terminal-stage'].includes(document.fullscreenElement?.id ?? ''))
      void document.exitFullscreen().catch(() => {});
    this.desktopFullscreen.set(false);
    this.desktopPanel.set('');
    this.remote.close();
    this.displays = [];
    this.selectedDisplay = '';
    this.fileStatus.set('');
    this.terminal?.dispose();
    this.terminal = undefined;
    this.fitTerminal = undefined;
    this.resizeObserver?.disconnect();
    this.modal.set('');
    this.secret.set('');
    this.recovery.set([]);
    this.clipboardText = '';
    this.managedUserPassword = '';
  }
  async setupTotp() {
    await this.run(async () => {
      const result = await this.api.request<{ secret: string }>('auth/totp/setup', 'POST');
      this.totpSecret.set(result.secret);
    });
  }
  async confirmTotp() {
    await this.run(async () => {
      this.recovery.set(
        await this.api.request<string[]>('auth/totp/confirm', 'POST', { code: this.code }),
      );
      this.code = '';
      this.totpSecret.set('');
    });
  }
  async createKey() {
    await this.run(async () => {
      const result = await this.api.request<{ token: string }>('api-keys', 'POST', {
        name: this.keyName,
        scopes: this.keyScopes,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      this.secret.set(result.token);
      this.modal.set('secret');
      this.keyName = '';
      await this.load();
    });
  }
  editCatalog(row: Record<string, unknown>) {
    this.editId = String(row['id']);
    this.catalog = Object.fromEntries(
      this.fields().map((field) => [field, String(row[field] ?? '')]),
    );
    this.modal.set('catalog');
  }
  async deleteRow(row: Record<string, unknown>) {
    if (!confirm(this.t('revoke') + '?')) return;
    await this.run(async () => {
      await this.api.request(
        (this.section() === 'keys' ? 'api-keys' : 'catalog/' + this.section()) + '/' + row['id'],
        'DELETE',
      );
      await this.load();
    });
  }
  countries = computed(() => {
    const names = new Intl.DisplayNames([this.i18n.lang()], { type: 'region' });
    return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
      a.name.localeCompare(b.name, this.i18n.lang()),
    );
  });
  provinces = [...TURKEY_PROVINCES].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  districts() {
    return this.provinces.find((p) => p.name === this.catalog['province'])?.districts ?? [];
  }
  newCatalog() {
    this.editId = '';
    this.catalog = {};
    if (this.section() === 'locations') this.selectCountry('TR');
    this.modal.set('catalog');
  }
  selectCountry(code: string) {
    this.catalog['countryCode'] = code;
    this.catalog['countryName'] =
      new Intl.DisplayNames(['tr'], { type: 'region' }).of(code) ?? code;
    for (const key of ['province', 'district', 'city', 'postalCode']) this.catalog[key] = '';
  }
  selectProvince(name: string) {
    this.catalog['province'] = name;
    this.catalog['city'] = name;
    this.catalog['district'] = '';
    this.catalog['postalCode'] = '';
  }
  managedUserId = '';
  managedUserEmail = '';
  managedUserPassword = '';
  managedUserUnlock = false;
  managedUserRevoke = false;
  manageUser(row: Record<string, unknown>) {
    this.managedUserId = String(row['id']);
    this.managedUserEmail = String(row['email']);
    this.managedUserPassword = '';
    this.managedUserUnlock = false;
    this.managedUserRevoke = false;
    this.modal.set('manageUser');
  }
  async saveManagedUser() {
    await this.run(async () => {
      await this.api.request('users/' + this.managedUserId, 'PUT', {
        email: this.managedUserEmail,
        newPassword: this.managedUserPassword || null,
        unlock: this.managedUserUnlock,
        revokeSessions: this.managedUserRevoke,
      });
      this.managedUserPassword = '';
      this.modal.set('');
      await this.load();
    });
  }
  fields() {
    return this.section() === 'contacts'
      ? ['firstName', 'lastName', 'displayName', 'phone', 'email', 'description']
      : this.section() === 'locations'
        ? [
            'countryCode',
            'countryName',
            'province',
            'district',
            'city',
            'postalCode',
            'addressLine',
          ]
        : ['name'];
  }
  async saveCatalog() {
    await this.run(async () => {
      await this.api.request(
        'catalog/' + this.section() + (this.editId ? '/' + this.editId : ''),
        this.editId ? 'PUT' : 'POST',
        this.catalog,
      );
      this.editId = '';
      this.catalog = {};
      this.modal.set('');
      await this.load();
    });
  }
}
