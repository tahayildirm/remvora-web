import { signal } from '@angular/core';
import { TURKEY_PROVINCES, COUNTRY_CODES } from './location-data';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Api } from './api';
import { I18n } from './i18n';
import { vi } from 'vitest';
describe('Remvora panel', () => {
  it('does not show inventory without a verified session', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: Api, useValue: { request: () => Promise.reject(new Error('UNAUTHORIZED')) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sign in');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('input[name=organization]')).toBeNull();
    fixture.destroy();
  });
  it('translates security failures without exposing stack traces', () => {
    const i18n = new I18n();
    i18n.lang.set('tr');
    expect(i18n.t('FORBIDDEN')).toContain('yetkiniz yok');
  });
});

// Pointer release must reach the device even after dragging beyond the video.
describe('desktop pointer capture', () => {
  it('releases the remote mouse outside the image bounds', () => {
    const control = vi.fn();
    const capture = vi.fn();
    const release = vi.fn();
    const video = {
      videoWidth: 100,
      videoHeight: 100,
      focus: vi.fn(),
      setPointerCapture: capture,
      hasPointerCapture: () => true,
      releasePointerCapture: release,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    };
    const app = { remote: { control }, lastPointer: 0 } as unknown as App;
    const event = (x: number) =>
      ({
        currentTarget: video,
        clientX: x,
        clientY: 50,
        pointerId: 7,
        button: 0,
      }) as unknown as PointerEvent;
    App.prototype.desktopPointer.call(app, event(50), 'down');
    expect(capture).toHaveBeenCalledWith(7);
    App.prototype.desktopPointer.call(app, event(150), 'up');
    expect(release).toHaveBeenCalledWith(7);
    expect(control).toHaveBeenLastCalledWith({ type: 'up', button: 0 });
  });
});

describe('desktop overlay controls', () => {
  it('hides open tools without sending clicks to the remote desktop', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const control = vi.spyOn(app.remote, 'control');
    app.desktopPanel.set('files');
    app.toggleDesktopTools();
    expect(app.desktopToolsVisible()).toBe(false);
    expect(app.desktopPanel()).toBe('');
    expect(control).toHaveBeenCalledWith({ type: 'releaseAll' });
    expect(control).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'down' }));
    fixture.destroy();
  });
  it('requests fullscreen for the stage including the tools and handles denial', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const stage = document.createElement('div');
    stage.id = 'desktop-stage';
    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(stage, 'requestFullscreen', { value: request });
    document.body.append(stage);
    await app.toggleDesktopFullscreen();
    expect(request).toHaveBeenCalledOnce();
    request.mockRejectedValueOnce(new Error('denied'));
    await app.toggleDesktopFullscreen();
    expect(app.error()).toBe(app.t('fullscreenUnavailable'));
    stage.remove();
    fixture.destroy();
  });
});

describe('permanent device deletion', () => {
  for (const answers of [[false], [true, false], [true, true]]) {
    it('requires both confirmations: ' + answers.join(', '), async () => {
      const confirmation = vi.spyOn(globalThis, 'confirm');
      for (const answer of answers) confirmation.mockReturnValueOnce(answer);
      const request = vi.fn().mockResolvedValue(undefined);
      const load = vi.fn().mockResolvedValue(undefined);
      const app = {
        busy: () => false,
        t: (key: string) => key,
        api: { request },
        load,
        run: (action: () => Promise<void>) => action(),
      } as unknown as App;
      try {
        await App.prototype.deletePermanently.call(app, {
          id: 'device-id',
          name: 'Pi',
          deviceCode: 'device-code',
        } as Parameters<App['deletePermanently']>[0]);
        expect(confirmation).toHaveBeenCalledTimes(answers.length);
        if (answers.every(Boolean)) {
          expect(request).toHaveBeenCalledExactlyOnceWith(
            'devices/device-id/delete-permanently',
            'POST',
            { confirmation: 'device-code' },
          );
          expect(load).toHaveBeenCalledOnce();
        } else {
          expect(request).not.toHaveBeenCalled();
          expect(load).not.toHaveBeenCalled();
        }
      } finally {
        confirmation.mockRestore();
      }
    });
  }
});

describe('presence and address selection', () => {
  it('does not confuse approved enrollment with an online device', () => {
    const device = { id: 'pi', enrollmentStatus: 'Active' } as Parameters<
      App['connectionLabel']
    >[0];
    const app = { presence: signal({}) } as unknown as App;
    expect(App.prototype.connectionLabel.call(app, device)).toBe('presenceUnknown');
    app.presence.set({ pi: { online: false, busy: false, lastSignalAt: null } });
    expect(App.prototype.connectionLabel.call(app, device)).toBe('presenceOffline');
    app.presence.set({ pi: { online: true, busy: true, lastSignalAt: null } });
    expect(App.prototype.connectionLabel.call(app, device)).toBe('presenceBusy');
  });
  it('removes stale online badges when the presence request fails', async () => {
    const app = {
      me: () => ({}),
      section: () => 'devices',
      page: () => 0,
      pageSize: 100,
      presence: signal({ pi: { online: true, busy: false, lastSignalAt: null } }),
      api: { request: () => Promise.reject(new Error('offline')) },
    } as unknown as App;
    await App.prototype.refreshPresence.call(app);
    expect(app.presence()).toEqual({});
  });
  it('clears dependent values and fills the city when changing province', () => {
    const app = {
      catalog: {
        province: 'Ankara',
        district: 'Çankaya',
        city: 'Ankara',
        postalCode: '06000',
        addressLine: 'Keep street',
      },
    } as unknown as App;
    App.prototype.selectProvince.call(app, 'İstanbul');
    expect(app.catalog).toEqual({
      province: 'İstanbul',
      district: '',
      city: 'İstanbul',
      postalCode: '',
      addressLine: 'Keep street',
    });
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(TURKEY_PROVINCES).toHaveLength(81);
    expect(TURKEY_PROVINCES.reduce((n, p) => n + p.districts.length, 0)).toBe(973);
  });
});

describe('mobile remote tools', () => {
  it('encodes terminal Ctrl-C, arrows and Alt without running a command', () => {
    const input = vi.fn();
    const app = {
      remoteKind: 'Terminal',
      remote: { input },
      mobileCtrl: true,
      mobileAlt: false,
    } as unknown as App;
    App.prototype.mobileKey.call(app, 'c');
    expect(new TextDecoder().decode(input.mock.calls[0][0])).toBe('\x03');
    expect(app.mobileCtrl).toBe(false);
    App.prototype.mobileKey.call(app, 'ArrowUp');
    expect(new TextDecoder().decode(input.mock.calls[1][0])).toBe('\x1b[A');
    app.mobileAlt = true;
    App.prototype.mobileKey.call(app, 'd');
    expect(new TextDecoder().decode(input.mock.calls[2][0])).toBe('\x1bd');
  });
  it.each([
    [true, true],
    [true, false],
    [false, true],
  ])('respects automatic keyboard for tap=%s enabled=%s', (tapped, automatic) => {
    const video = document.createElement('video');
    video.id = 'desktop-video';
    Object.defineProperty(video, 'videoWidth', { value: 800 });
    Object.defineProperty(video, 'videoHeight', { value: 600 });
    document.body.appendChild(video);
    const openMobileKeyboard = vi.fn();
    const up = vi.fn(() => tapped);
    const app = {
      gestures: { up },
      autoKeyboardEnabled: () => automatic,
      openMobileKeyboard,
      viewZoom: () => 1,
      viewPan: () => ({ x: 0, y: 0 }),
      remote: { requestTextFocus: vi.fn(), isTextField: () => false },
    } as unknown as App;
    App.prototype.touchPointer.call(
      app,
      {
        preventDefault: vi.fn(),
        clientX: 10,
        clientY: 10,
        pointerId: 1,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
          hasPointerCapture: () => false,
        },
      } as unknown as PointerEvent,
      'up',
    );
    expect(up).toHaveBeenCalled();
    expect(openMobileKeyboard).toHaveBeenCalledTimes(tapped && automatic ? 1 : 0);
    video.remove();
  });
  it('focuses the terminal directly from the keyboard button', () => {
    const focus = vi.fn();
    App.prototype.openMobileKeyboard.call({
      remoteKind: 'Terminal',
      terminal: { focus },
    } as unknown as App);
    expect(focus).toHaveBeenCalledOnce();
  });
  it('focuses the native keyboard without opening a tools panel', () => {
    const input = document.createElement('textarea');
    input.id = 'desktop-keyboard-input';
    document.body.appendChild(input);
    const visible = vi.fn();
    const app = { keyboardVisible: { set: visible } };
    App.prototype.openMobileKeyboard.call(app as unknown as App);
    expect(document.activeElement).toBe(input);
    expect(visible).not.toHaveBeenCalled();
    expect(input.selectionStart).toBe(1);
    input.remove();
  });
  it('refocuses after Android hides the keyboard without blurring the input', () => {
    const input = document.createElement('textarea');
    input.id = 'desktop-keyboard-input';
    document.body.appendChild(input);
    input.focus();
    const blur = vi.spyOn(input, 'blur');
    const focus = vi.spyOn(input, 'focus');
    App.prototype.openMobileKeyboard.call({ remoteKind: 'Desktop' } as App);
    expect(blur).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(blur.mock.invocationCallOrder[0]).toBeLessThan(focus.mock.invocationCallOrder[0]);
    expect(document.activeElement).toBe(input);
    input.remove();
  });
  it('streams text and deletions immediately and commits composition only once', () => {
    const input = document.createElement('textarea');
    const mobileKey = vi.fn();
    const app = { mobileKey } as unknown as App;
    const dispatch = (inputType: string, isComposing = false) =>
      App.prototype.directKeyboardInput.call(app, {
        target: input,
        inputType,
        isComposing,
      } as unknown as Event);
    input.value = ' a';
    dispatch('insertText');
    expect(mobileKey).toHaveBeenLastCalledWith('a');
    input.value = ' ş';
    dispatch('insertCompositionText', true);
    expect(mobileKey).toHaveBeenCalledTimes(1);
    dispatch('insertCompositionText');
    dispatch('insertText');
    expect(mobileKey.mock.calls.map((call) => call[0])).toEqual(['a', 'ş']);
    input.value = '';
    dispatch('deleteContentBackward');
    expect(mobileKey).toHaveBeenLastCalledWith('Backspace');
    input.value = ' \n';
    dispatch('insertLineBreak');
    expect(mobileKey).toHaveBeenLastCalledWith('Enter');
  });
  it('defaults to automatic direct touch without enabling a relative cursor', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance.inputMode()).toBe('auto');
    expect(fixture.componentInstance.viewZoom()).toBe(1);
    fixture.destroy();
  });
});
