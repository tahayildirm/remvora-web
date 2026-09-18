import { test, expect, chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('fresh device enrollment and browser-to-agent remote terminal', async ({ page }) => {
  test.setTimeout(120000);
  const credentials = JSON.parse(process.env['REMVORA_E2E_CREDENTIALS'] ?? '{}');
  const root = process.env['REMVORA_AGENT_ROOT'];
  test.skip(
    !credentials.email || !credentials.password || !root,
    'Requires an isolated acceptance API and agent project',
  );
  const agent = join(root!, 'target/debug/remvora-agent');
  const state = join(root!, '.runtime', 'acceptance-' + Date.now());
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const share = join(state, 'shared');
  mkdirSync(share, { mode: 0o700 });
  const server = process.env['REMVORA_E2E_SERVER'] ?? 'http://127.0.0.1:5187/';
  const args = [
    '--server',
    server,
    ...(server.startsWith('http:') ? ['--allow-loopback-http'] : []),
    '--state',
    state,
  ];
  await page.addInitScript(() => {
    const original = RTCPeerConnection.prototype.createDataChannel;
    (window as unknown as { terminalOutput: string }).terminalOutput = '';
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      (window as unknown as { remotePeer: RTCPeerConnection }).remotePeer = this;
      const channel = original.apply(this, args);
      if (args[0] === 'remvora.input.v1')
        (window as unknown as { controlChannel: RTCDataChannel }).controlChannel = channel;
      channel.addEventListener('message', (event) => {
        if (event.data instanceof ArrayBuffer)
          (window as unknown as { terminalOutput: string }).terminalOutput +=
            new TextDecoder().decode(event.data);
      });
      return channel;
    };
  });
  await page.goto('/');
  await page.getByLabel('Email address').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your device fleet' })).toBeVisible();
  const deviceName = 'Acceptance workstation ' + Date.now();
  await page.getByRole('button', { name: 'Add device' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(deviceName);
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  const row = page.locator('tr').filter({ hasText: deviceName });
  await row.getByRole('button', { name: 'Enroll', exact: true }).click();
  const token = (await page.locator('pre.secret').textContent())!.trim();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  execFileSync(agent, [...args, 'enroll'], {
    env: { ...process.env, REMVORA_ENROLLMENT_TOKEN: token },
    stdio: 'pipe',
  });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/approve') && response.status() === 204,
    ),
    row.getByRole('button', { name: 'Approve' }).click(),
  ]);
  execFileSync(agent, [...args, 'activate'], { stdio: 'pipe' });
  const log = openSync(join(state, 'agent.log'), 'a', 0o600);
  const processAgent = spawn(
    agent,
    [
      ...args,
      '--allow-terminal',
      ...(process.env['REMVORA_E2E_DESKTOP'] === '1'
        ? ['--allow-desktop', '--file-root', share]
        : []),
      ...(process.env['REMVORA_E2E_AUDIO'] === '1' ? ['--allow-audio'] : []),
      ...(process.env['REMVORA_E2E_CLIPBOARD'] === '1' ? ['--allow-clipboard'] : []),
      ...(process.env['REMVORA_E2E_MONITOR']
        ? ['--monitor-id', process.env['REMVORA_E2E_MONITOR']]
        : []),
      'run',
    ],
    {
      stdio: ['ignore', log, log],
    },
  );
  try {
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(row).toContainText('Active');
    await page.screenshot({ path: '.runtime/dashboard.png', fullPage: true });
    await expect
      .poll(async () => {
        const result = await page.evaluate(async () =>
          fetch('/api/v1/devices').then((r) => r.json()),
        );
        const device = result.find((x: { name: string }) => x.name === deviceName);
        return page.evaluate(
          async (id) =>
            fetch('/api/v1/devices/' + id + '/presence')
              .then((r) => r.json())
              .then((x) => x.online),
          device.id,
        );
      })
      .toBe(true);
    await row.getByRole('button', { name: 'Terminal' }).click();
    await expect(page.locator('.session-status')).toHaveText('Connected', { timeout: 35000 });
    await page
      .locator('.xterm-helper-textarea')
      .pressSequentially("printf 'REMVORA_BROWSER_%s\\n' VERIFIED", { delay: 15 });
    await page.locator('.xterm-helper-textarea').press('Enter');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { terminalOutput: string }).terminalOutput),
      )
      .toContain('REMVORA_BROWSER_VERIFIED');
    // The server sends a WebSocket keepalive every 20 seconds. A Pong must not close the agent.
    await page.waitForTimeout(23000);
    await expect(page.locator('.session-status')).toHaveText('Connected');
    await page
      .locator('.xterm-helper-textarea')
      .pressSequentially("printf 'REMVORA_KEEPALIVE_%s\\n' VERIFIED");
    await page.locator('.xterm-helper-textarea').press('Enter');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { terminalOutput: string }).terminalOutput),
      )
      .toContain('REMVORA_KEEPALIVE_VERIFIED');
    await page.screenshot({ path: '.runtime/terminal.png', fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    if (process.env['REMVORA_E2E_DESKTOP'] === '1') {
      // Let the previous close reach the agent before granting the next single session.
      await expect
        .poll(async () =>
          page.evaluate(async () =>
            fetch('/api/v1/audit')
              .then((r) => r.json())
              .then((rows) =>
                rows.some((x: { eventType: string }) => x.eventType === 'TERMINAL_ENDED'),
              ),
          ),
        )
        .toBe(true);
      await row.getByRole('button', { name: 'Desktop', exact: true }).click();
      await expect(page.locator('.session-status')).toHaveText('Connected', { timeout: 35000 });
      await expect
        .poll(
          () =>
            page
              .locator('#desktop-video')
              .evaluate((video) => (video as HTMLVideoElement).videoWidth),
          { timeout: 10000 },
        )
        .toBeGreaterThan(0);
      const firstVideoTime = await page
        .locator('#desktop-video')
        .evaluate((video) => (video as HTMLVideoElement).currentTime);
      await expect
        .poll(
          () =>
            page
              .locator('#desktop-video')
              .evaluate((video) => (video as HTMLVideoElement).currentTime),
          { timeout: 45000 },
        )
        .toBeGreaterThan(firstVideoTime + 30);
      await page.getByRole('button', { name: 'Displays', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Displays' })).toBeVisible();
      if (process.env['REMVORA_E2E_MONITOR'])
        await page
          .getByRole('combobox', { name: 'Displays' })
          .selectOption(process.env['REMVORA_E2E_MONITOR']);
      if (process.env['REMVORA_E2E_AUDIO'] === '1') {
        await page.getByLabel('Mute system audio').uncheck();
        const player = spawn('/usr/bin/afplay', ['.runtime/acceptance-tone.wav']);
        try {
          await expect
            .poll(
              () =>
                page.evaluate(async () => {
                  let energy = 0;
                  for (const report of (
                    await (
                      window as unknown as { remotePeer: RTCPeerConnection }
                    ).remotePeer.getStats()
                  ).values()) {
                    if (report.type === 'inbound-rtp' && report.kind === 'audio')
                      energy += report.totalAudioEnergy ?? 0;
                  }
                  return energy;
                }),
              { timeout: 15000 },
            )
            .toBeGreaterThan(0.00001);
        } finally {
          player.kill();
        }
      }
      const payload = Buffer.from('Remvora binary file roundtrip\0' + 'x'.repeat(30000));
      await page.locator('input[type=file]').setInputFiles({
        name: 'roundtrip.bin',
        mimeType: 'application/octet-stream',
        buffer: payload,
      });
      await expect(page.getByRole('status')).toHaveText('Transfer verified');
      expect(readFileSync(join(share, 'roundtrip.bin'))).toEqual(payload);
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download: roundtrip.bin', exact: false }).click();
      const download = await downloadEvent;
      expect(readFileSync((await download.path())!)).toEqual(payload);
      if (process.env['REMVORA_E2E_CLIPBOARD'] === '1') {
        await page.getByRole('button', { name: 'Read remote clipboard' }).click();
        await expect(page.getByLabel('Text to send to remote clipboard')).toHaveValue(
          'Remvora acceptance clipboard initial',
        );
        await page
          .getByLabel('Text to send to remote clipboard')
          .fill('Remvora acceptance clipboard roundtrip');
        await page.getByRole('button', { name: 'Send clipboard text' }).click();
        await expect(page.locator('.session-status')).toHaveText('Clipboard updated');
        await page.getByLabel('Text to send to remote clipboard').fill('');
        await page.getByRole('button', { name: 'Read remote clipboard' }).click();
        await expect(page.getByLabel('Text to send to remote clipboard')).toHaveValue(
          'Remvora acceptance clipboard roundtrip',
        );
      } else {
        await page.getByLabel('Text to send to remote clipboard').fill('Remvora denial test');
        await page.getByRole('button', { name: 'Send clipboard text' }).click();
        await expect(page.locator('.session-status')).toHaveText(
          'Clipboard is disabled on this agent',
        );
      }
      if (process.env['REMVORA_E2E_INPUT'] === '1') {
        const localBrowser = await chromium.launch({
          channel: 'chrome',
          headless: false,
          args: ['--window-position=100,100', '--window-size=800,600'],
        });
        try {
          const target = await localBrowser.newPage({ viewport: null });
          await target.setContent(
            '<title>Remvora isolated input verification</title><body style="margin:0;background:#e8faf5;font-family:system-ui"><button id="target" style="position:fixed;inset:15%;font-size:24px">Remvora input test — isolated window</button><input id="keyboard" aria-label="Test input" style="position:fixed;bottom:8px;left:10%;width:80%;height:40px"><script>window.testKeys=[];document.onkeydown=e=>window.testKeys.push({key:e.key,meta:e.metaKey,ctrl:e.ctrlKey});document.onpaste=e=>document.body.dataset.pasted=e.clipboardData.getData("text/plain");document.onmousemove=()=>{document.body.dataset.moved="yes";};document.onmousedown=e=>{document.body.dataset.down=e.target.id;};document.querySelector("button").onclick=()=>{document.body.dataset.clicked="yes";document.querySelector("input").focus();};</script></body>',
          );
          await target.bringToFront();
          await expect.poll(() => target.evaluate(() => document.hasFocus())).toBe(true);
          const position = await target.evaluate(() => ({
            x: (screenX + outerWidth / 2) / screen.width,
            y: (screenY + outerHeight / 2) / screen.height,
          }));
          expect(position.x).toBeGreaterThan(0);
          expect(position.x).toBeLessThan(1);
          expect(position.y).toBeGreaterThan(0);
          expect(position.y).toBeLessThan(1);
          const video = page.locator('#desktop-video');
          const bounds = (await video.boundingBox())!;
          const dimensions = await video.evaluate((element) => ({
            width: (element as HTMLVideoElement).videoWidth,
            height: (element as HTMLVideoElement).videoHeight,
          }));
          const scale = Math.min(
            bounds.width / dimensions.width,
            bounds.height / dimensions.height,
          );
          const clientX =
            bounds.x +
            (bounds.width - dimensions.width * scale) / 2 +
            position.x * dimensions.width * scale;
          const clientY =
            bounds.y +
            (bounds.height - dimensions.height * scale) / 2 +
            position.y * dimensions.height * scale;
          await video.dispatchEvent('mousemove', { clientX, clientY, button: 0 });
          await video.dispatchEvent('mousedown', { clientX, clientY, button: 0 });
          await video.dispatchEvent('mouseup', { clientX, clientY, button: 0 });
          await expect(target.locator('body')).toHaveAttribute('data-moved', 'yes');
          await expect(target.locator('body')).toHaveAttribute('data-clicked', 'yes');
          await expect.poll(() => target.evaluate(() => document.hasFocus())).toBe(true);
          await video.dispatchEvent('keydown', { key: 'r' });
          await video.dispatchEvent('keyup', { key: 'r' });
          await expect(target.locator('#keyboard')).toHaveValue('r');
          if (process.env['REMVORA_E2E_CLIPBOARD'] === '1') {
            await video.evaluate((element) => {
              const data = new DataTransfer();
              data.setData('text/plain', 'Remvora acceptance clipboard shortcut');
              element.dispatchEvent(
                new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: data,
                }),
              );
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
            await expect
              .poll(() =>
                target.evaluate(() => ({
                  value: (document.querySelector('#keyboard') as HTMLInputElement).value,
                  keys: (window as unknown as { testKeys: unknown }).testKeys,
                  paste: document.body.dataset['pasted'],
                })),
              )
              .toMatchObject({ value: 'rRemvora acceptance clipboard shortcut' });
            await target
              .locator('#keyboard')
              .evaluate((element) =>
                (element as HTMLInputElement).setSelectionRange(
                  1,
                  (element as HTMLInputElement).value.length,
                ),
              );
            await video.dispatchEvent('keydown', { key: 'c', ctrlKey: true });
            await video.dispatchEvent('keyup', { key: 'c', ctrlKey: true });
            await expect(page.getByLabel('Text to send to remote clipboard')).toHaveValue(
              'Remvora acceptance clipboard shortcut',
            );
            await video.dispatchEvent('keydown', { key: 'x', ctrlKey: true });
            await video.dispatchEvent('keyup', { key: 'x', ctrlKey: true });
            await expect(target.locator('#keyboard')).toHaveValue('r');
          }
          await video.dispatchEvent('keydown', { key: 'F2' });
          await video.dispatchEvent('keyup', { key: 'F2' });
        } finally {
          await localBrowser.close();
        }
      }
      await page.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await row.getByRole('button', { name: 'Reboot', exact: true }).click();
    const code = (await page.getByRole('dialog').locator('code').textContent())!;
    await page.getByRole('dialog').getByLabel('Device code').fill(code);
    await page.getByRole('dialog').getByRole('button', { name: 'Reboot', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await fetch('/api/v1/audit').then((r) => r.json())).some(
            (row: { eventType: string }) => row.eventType === 'DEVICE_REBOOT_DENIED',
          ),
        ),
      )
      .toBe(true);
    await row.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(row).toContainText('Disabled');
    await row.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(row).toContainText('Active');
    await page.locator('aside button').filter({ hasText: 'Security' }).click();
    await expect(page.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
    await expect(page.getByText('This session', { exact: false })).toBeVisible();
  } finally {
    processAgent.kill('SIGINT');
    closeSync(log);
  }
});
