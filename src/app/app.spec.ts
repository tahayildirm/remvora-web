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
  it('renders the keyboard before focusing synchronously in the user gesture', () => {
    const input = document.createElement('input');
    input.id = 'mobile-remote-text';
    const visible = vi.fn();
    const render = vi.fn(() => document.body.appendChild(input));
    const app = { keyboardVisible: { set: visible }, changes: { detectChanges: render } };
    App.prototype.openMobileKeyboard.call(app as unknown as App);
    expect(visible).toHaveBeenCalledWith(true);
    expect(document.activeElement).toBe(input);
    input.remove();
  });
  it('defaults to automatic direct touch without enabling a relative cursor', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance.inputMode()).toBe('auto');
    expect(fixture.componentInstance.viewZoom()).toBe(1);
    fixture.destroy();
  });
});
