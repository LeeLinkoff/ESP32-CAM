import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { CameraInfo, CameraService, ConnectionStatus, DiagnosticEntry, DiagnosticLevel, FirmwareTestReport, SerialPortInfo, Transport } from './camera.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly api = inject(CameraService);
  // Signal-backed accessors preserve the component/template API (including
  // [(ngModel)]) and schedule view updates without Zone.js or manual CD.
  private readonly modeValue = signal<Transport>('usb');
  get mode(): Transport { return this.modeValue(); }
  set mode(value: Transport) { this.modeValue.set(value); }
  private readonly selectedPortValue = signal('');
  get selectedPort(): string { return this.selectedPortValue(); }
  set selectedPort(value: string) { this.selectedPortValue.set(value); }
  private readonly hostValue = signal('');
  get host(): string { return this.hostValue(); }
  set host(value: string) { this.hostValue.set(value); }
  private readonly portsValue = signal<SerialPortInfo[]>([]);
  get ports(): SerialPortInfo[] { return this.portsValue(); }
  set ports(value: SerialPortInfo[]) { this.portsValue.set(value); }
  private readonly statusValue = signal<ConnectionStatus>({ connected: false, mode: 'usb' });
  get status(): ConnectionStatus { return this.statusValue(); }
  set status(value: ConnectionStatus) { this.statusValue.set(value); }
  private readonly infoValue = signal<CameraInfo | null>(null);
  get info(): CameraInfo | null { return this.infoValue(); }
  set info(value: CameraInfo | null) { this.infoValue.set(value); }
  private readonly testReportValue = signal<FirmwareTestReport | null>(null);
  get testReport(): FirmwareTestReport | null { return this.testReportValue(); }
  set testReport(value: FirmwareTestReport | null) { this.testReportValue.set(value); }
  private readonly imageUrlValue = signal<string | null>(null);
  get imageUrl(): string | null { return this.imageUrlValue(); }
  set imageUrl(value: string | null) { this.imageUrlValue.set(value); }
  private readonly busyValue = signal(false);
  get busy(): boolean { return this.busyValue(); }
  set busy(value: boolean) { this.busyValue.set(value); }
  private readonly messageValue = signal('Choose your connection. The ESP32-CAM listens on all configured transports concurrently.');
  get message(): string { return this.messageValue(); }
  set message(value: string) { this.messageValue.set(value); }
  private readonly errorValue = signal('');
  get error(): string { return this.errorValue(); }
  set error(value: string) { this.errorValue.set(value); }
  private readonly activeTabValue = signal<'camera' | 'diagnostics'>('camera');
  get activeTab(): 'camera' | 'diagnostics' { return this.activeTabValue(); }
  set activeTab(value: 'camera' | 'diagnostics') { this.activeTabValue.set(value); }
  private readonly themeValue = signal<'light' | 'dark'>('light');
  get theme(): 'light' | 'dark' { return this.themeValue(); }
  set theme(value: 'light' | 'dark') { this.themeValue.set(value); }
  private readonly logsValue = signal<DiagnosticEntry[]>([]);
  get logs(): DiagnosticEntry[] { return this.logsValue(); }
  set logs(value: DiagnosticEntry[]) { this.logsValue.set(value); }
  private readonly clientLogsValue = signal<DiagnosticEntry[]>([]);
  get clientLogs(): DiagnosticEntry[] { return this.clientLogsValue(); }
  set clientLogs(value: DiagnosticEntry[]) { this.clientLogsValue.set(value); }
  private readonly logLevelValue = signal<DiagnosticLevel | 'all'>('all');
  get logLevel(): DiagnosticLevel | 'all' { return this.logLevelValue(); }
  set logLevel(value: DiagnosticLevel | 'all') { this.logLevelValue.set(value); }
  private readonly logSearchValue = signal('');
  get logSearch(): string { return this.logSearchValue(); }
  set logSearch(value: string) { this.logSearchValue.set(value); }
  private readonly autoRefreshLogsValue = signal(true);
  get autoRefreshLogs(): boolean { return this.autoRefreshLogsValue(); }
  set autoRefreshLogs(value: boolean) { this.autoRefreshLogsValue.set(value); }
  private readonly logErrorValue = signal('');
  get logError(): string { return this.logErrorValue(); }
  set logError(value: string) { this.logErrorValue.set(value); }
  private readonly logLoadingValue = signal(false);
  get logLoading(): boolean { return this.logLoadingValue(); }
  set logLoading(value: boolean) { this.logLoadingValue.set(value); }
  private readonly activeOperationValue = signal('');
  get activeOperation(): string { return this.activeOperationValue(); }
  set activeOperation(value: string) { this.activeOperationValue.set(value); }
  private readonly elapsedValue = signal(0);
  get operationElapsedSeconds(): number { return this.elapsedValue(); }
  set operationElapsedSeconds(value: number) { this.elapsedValue.set(value); }
  private readonly lastOperationValue = signal('None');
  get lastOperation(): string { return this.lastOperationValue(); }
  set lastOperation(value: string) { this.lastOperationValue.set(value); }
  private operationStartedAt = 0;
  private operationCounter = 0;
  private requestCounter = 0;
  private readonly uiLogKey = 'esp32cam-ui-diagnostics';
  private lastLogId = 0;
  private logTimer: ReturnType<typeof setInterval> | null = null;
  private operationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onBrowserError = (event: ErrorEvent): void => {
    this.recordUi('error', 'Uncaught browser error', {
      message: event.message, file: event.filename, line: event.lineno,
    });
  };
  private readonly onPromiseRejection = (event: PromiseRejectionEvent): void => {
    this.recordUi('error', 'Unhandled promise rejection', { error: String(event.reason) });
  };
  private readonly onHttpTrace = (event: Event): void => {
    const trace = (event as CustomEvent).detail as {
      level?: DiagnosticLevel; message?: string; details?: Record<string, unknown>
    } | undefined;
    if (!trace || typeof trace.message !== 'string') return;
    this.recordUi(trace.level || 'info', trace.message, trace.details || {});
  };

  async ngOnInit(): Promise<void> {
    this.loadTheme();
    this.syncClientLogs();
    window.addEventListener('error', this.onBrowserError);
    window.addEventListener('unhandledrejection', this.onPromiseRejection);
    window.addEventListener('esp32cam-http-trace', this.onHttpTrace);
    if (new URLSearchParams(window.location.search).get('view') === 'diagnostics') {
      this.activeTab = 'diagnostics';
    }
    this.logTimer = setInterval(() => {
      this.syncClientLogs();
      if (this.activeTab === 'diagnostics' && this.autoRefreshLogs) void this.refreshLogs();
    }, 1500);
    this.operationTimer = setInterval(() => {
      if (this.busy) {
        this.operationElapsedSeconds = (Date.now() - this.operationStartedAt) / 1000;
      }
    }, 250);
    this.recordUi('info', 'Angular UI initialized', {
      view: this.activeTab, theme: this.theme, revision: '2026-11-02-zoneless-signals'
    });
    await Promise.all([this.refreshPorts(), this.refreshStatus(), this.refreshLogs()]);
  }

  ngOnDestroy(): void {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    if (this.logTimer) clearInterval(this.logTimer);
    if (this.operationTimer) clearInterval(this.operationTimer);
    window.removeEventListener('error', this.onBrowserError);
    window.removeEventListener('unhandledrejection', this.onPromiseRejection);
    window.removeEventListener('esp32cam-http-trace', this.onHttpTrace);
  }

  get usesPort(): boolean { return this.mode === 'usb' || this.mode === 'bluetooth'; }

  get activeConnectionMatchesSelection(): boolean {
    return this.status.connected && this.status.mode === this.mode &&
      (this.usesPort ? this.status.port === this.selectedPort : this.status.host === this.host);
  }

  get recentClientLogs(): DiagnosticEntry[] {
    return this.clientLogs.slice(-25).reverse();
  }

  get commandDisabledReason(): string {
    if (this.busy) return `Waiting for ${this.activeOperation} (${this.operationElapsedSeconds.toFixed(1)} seconds). Click Stop waiting to cancel the browser request.`;
    if (!this.status.connected) return 'Camera commands are disabled because Node reports DISCONNECTED. Connect to the MCU first.';
    return 'Camera commands are enabled. Node reports CONNECTED and the UI is not busy.';
  }

  get allLogs(): DiagnosticEntry[] {
    return [...this.logs, ...this.clientLogs].sort((a, b) =>
      a.time.localeCompare(b.time) || a.id - b.id).slice(-600);
  }

  get visibleLogs(): DiagnosticEntry[] {
    const search = this.logSearch.trim().toLowerCase();
    return this.allLogs.filter((entry) =>
      (this.logLevel === 'all' || this.logLevel === entry.level) &&
      (!search || `${entry.source} ${entry.message} ${JSON.stringify(entry.details)}`.toLowerCase().includes(search)));
  }

  private syncClientLogs(): void {
    try {
      const stored = JSON.parse(localStorage.getItem(this.uiLogKey) || '[]') as DiagnosticEntry[];
      if (Array.isArray(stored)) {
        this.clientLogs = stored.filter((entry) => entry && typeof entry.message === 'string').slice(-160);
      }
    } catch { /* Browser storage may be disabled or contain old data. */ }
  }

  private recordUi(level: DiagnosticLevel, message: string, details: Record<string, unknown> = {}): void {
    this.syncClientLogs();
    const entry: DiagnosticEntry = {
      id: Date.now() * 1000 + (++this.operationCounter % 1000),
      time: new Date().toISOString(), level, source: 'Angular UI', message, details,
    };
    this.clientLogs = [...this.clientLogs, entry].slice(-160);
    try { localStorage.setItem(this.uiLogKey, JSON.stringify(this.clientLogs)); } catch { /* Still visible in this window. */ }
    if (level === 'error') console.error(`[ESP32-CAM UI] ${message}`, details);
    else if (level === 'warn') console.warn(`[ESP32-CAM UI] ${message}`, details);
    else if (level === 'debug') console.debug(`[ESP32-CAM UI] ${message}`, details);
    else console.info(`[ESP32-CAM UI] ${message}`, details);
  }

  showTab(tab: 'camera' | 'diagnostics'): void {
    this.activeTab = tab;
    if (tab === 'diagnostics') void this.refreshLogs();
  }

  toggleTheme(): void {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light');
  }

  private loadTheme(): void {
    try {
      this.setTheme(localStorage.getItem('esp32cam-theme') === 'dark' ? 'dark' : 'light');
    } catch {
      this.setTheme('light');
    }
  }

  private setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('esp32cam-theme', theme); } catch { /* Storage may be restricted. */ }
  }

  async refreshLogs(): Promise<void> {
    if (this.logLoading) return;
    this.logLoading = true;
    try {
      let batch = await firstValueFrom(this.api.logs(this.lastLogId));
      if (batch.latestId < this.lastLogId) {
        // Node was restarted; its in-memory log IDs restarted too.
        this.lastLogId = 0;
        this.logs = [];
        batch = await firstValueFrom(this.api.logs(0));
      }
      this.lastLogId = batch.latestId;
      this.logs = [...this.logs, ...batch.entries].slice(-500);
      this.logError = '';
    } catch (error) {
      const nextError = `Cannot retrieve backend logs: ${this.describe(error)}`;
      if (this.logError !== nextError) this.recordUi('error', 'Backend diagnostic feed failed', { reason: nextError });
      this.logError = nextError;
    } finally {
      this.logLoading = false;
    }
  }

  async clearLogs(): Promise<void> {
    if (!window.confirm('Clear both backend and Angular UI diagnostic logs?')) return;
    try {
      const result = await firstValueFrom(this.api.clearLogs());
      this.logs = result.entries;
      this.lastLogId = result.latestId;
      this.clientLogs = [];
      try { localStorage.removeItem(this.uiLogKey); } catch { /* Storage may be unavailable. */ }
      this.recordUi('info', 'Diagnostic logs cleared by user');
      this.logError = '';
    } catch (error) {
      this.logError = this.describe(error);
      this.recordUi('error', 'Failed to clear backend logs', { reason: this.logError });
    }
  }

  downloadLogs(): void {
    const data = JSON.stringify({ generatedAt: new Date().toISOString(), entries: this.allLogs }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `esp32cam-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  openDiagnosticsWindow(): void {
    const url = `${window.location.origin}${window.location.pathname}?view=diagnostics`;
    window.open(url, 'esp32cam-diagnostics', 'width=1200,height=820');
  }

  async refreshPorts(): Promise<void> {
    this.recordUi('debug', 'Requesting available serial ports');
    try {
      this.ports = await firstValueFrom(this.api.ports());
      if (!this.selectedPort && this.ports.length) this.selectedPort = this.ports[0].path;
      this.recordUi('info', 'Serial ports received', { count: this.ports.length, ports: this.ports.map((port) => port.path) });
    } catch (error) {
      this.error = this.describe(error);
      this.recordUi('error', 'Cannot list serial ports', { reason: this.error });
    }
  }

  async refreshStatus(preserveError = false): Promise<void> {
    try {
      this.status = await firstValueFrom(this.api.status());
      this.recordUi('info', 'Backend connection status received', { ...this.status });
      if (this.status.connected) {
        this.mode = this.status.mode;
        this.selectedPort = this.status.port || this.selectedPort;
        this.host = this.status.host || this.host;
      }
    } catch (error) {
      if (!preserveError) this.error = this.describe(error);
      this.recordUi('error', 'Cannot retrieve connection status', { reason: this.describe(error) });
    }
  }

  async connect(): Promise<void> {
    await this.run('Connect', async () => {
      // The backend is authoritative. Do not issue another POST /api/connect
      // when its existing connection already matches the selected COM port.
      const existing = await firstValueFrom(this.api.status());
      const existingMatches = existing.connected && existing.mode === this.mode &&
        (this.usesPort ? existing.port === this.selectedPort : existing.host === this.host);
      if (existingMatches) {
        this.status = existing;
        this.message = `Already connected via ${this.mode.toUpperCase()} (${this.selectedPort || this.host}). No reconnect needed.`;
        this.recordUi('info', 'Connect avoided: Node is already connected to selected transport', { ...existing });
        return;
      }
      this.status = await firstValueFrom(this.api.connect({
        mode: this.mode,
        port: this.usesPort ? this.selectedPort : undefined,
        host: this.usesPort ? undefined : this.host,
      }));
      if (!this.status?.connected) throw new Error('The backend responded to Connect but did not report connected=true.');
      this.recordUi('info', 'Angular received transport connection confirmation', { ...this.status });
      // Do not block Connect on an immediate 'i' command. On USB, serial-open
      // can briefly reset the board; let the user request info independently.
      this.info = null;
      this.message = `Connected via ${this.status.mode.toUpperCase()}. Camera buttons are ready; click Info (i) to verify.`;
    });
  }

  async disconnect(): Promise<void> {
    await this.run('Disconnect', async () => {
      this.status = await firstValueFrom(this.api.disconnect());
      this.info = null;
      this.message = 'Client disconnected. ESP32-CAM USB, Bluetooth and configured Wi-Fi services remain active.';
    });
  }

  async getInfo(): Promise<void> {
    await this.run('Camera info (i)', async () => {
      this.info = null;
      this.message = 'Requesting camera information from /api/info…';
      // Use the established service and its HTTP diagnostics. This call was
      // already proven to return valid camera data; the UI state was the issue.
      const response = await firstValueFrom(this.api.info());
      if (!response || response.ok !== true || response.cmd !== 'i' || typeof response.cameraReady !== 'boolean') {
        throw new Error(`Unexpected response to i command: ${JSON.stringify(response)}`);
      }
      this.info = response;
      this.message = `Info (i) returned: ${JSON.stringify(response).replaceAll(',', ', ')}`;
      this.recordUi('info', 'Angular received and validated i response', { cameraInfo: response });
    });
  }

  async selfTest(): Promise<void> {
    await this.run('Firmware self-test (t)', async () => {
      this.testReport = await firstValueFrom(this.api.selfTest());
      if (!this.testReport || this.testReport.ok !== true || this.testReport.cmd !== 't') {
        throw new Error('Invalid firmware self-test response from the backend.');
      }
      this.recordUi('info', 'Angular received firmware test result', { passed: this.testReport.passed, checks: this.testReport.checks });
      this.message = this.testReport.passed ? 'Firmware self-test PASSED.' : 'Firmware self-test FAILED; review the checks below.';
    });
  }

  async capture(): Promise<void> {
    await this.run('Capture image (c)', async () => {
      const blob = await firstValueFrom(this.api.capture());
      if (blob.size < 4) throw new Error(`Capture returned an empty or truncated image (${blob.size} bytes).`);
      const start = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      const end = new Uint8Array(await blob.slice(blob.size - 2).arrayBuffer());
      if (start[0] !== 0xff || start[1] !== 0xd8 || end[0] !== 0xff || end[1] !== 0xd9) {
        throw new Error(`Invalid JPEG markers in ${blob.size}-byte capture. Expected FFD8 ... FFD9.`);
      }
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = URL.createObjectURL(blob);
      this.recordUi('info', 'Angular received valid JPEG', { imageBytes: blob.size, mimeType: blob.type });
      this.message = `Captured JPEG (${(blob.size / 1024).toFixed(1)} KB) (c).`;
    });
  }

  cancelPending(): void {
    this.recordUi('warn', 'User cancelled outstanding browser HTTP requests', { operation: this.activeOperation });
    this.api.cancelPending();
  }

  private async run(name: string, action: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.recordUi('warn', 'Ignored a duplicate click while another command was running', { requested: name, active: this.activeOperation });
      return;
    }
    const requestId = ++this.requestCounter;
    this.busy = true;
    this.activeOperation = name;
    this.operationStartedAt = Date.now();
    this.operationElapsedSeconds = 0;
    this.error = '';
    this.recordUi('info', 'UI command started', { requestId, command: name, transport: this.mode, connected: this.status.connected });
    try {
      await action();
      this.lastOperation = `${name}: succeeded (${Date.now() - this.operationStartedAt} ms)`;
      this.recordUi('info', 'UI command finished successfully', { requestId, command: name, elapsedMs: Date.now() - this.operationStartedAt });
    }
    catch (error) {
      this.error = this.describe(error);
      if (name === 'Camera info (i)') this.message = 'Camera info request failed. See the error and diagnostic log.';
      this.lastOperation = `${name}: FAILED (${this.error})`;
      this.recordUi('error', 'UI command failed', { requestId, command: name, reason: this.error, elapsedMs: Date.now() - this.operationStartedAt });
      // Status refresh must never replace or hide the original command error.
      void this.refreshStatus(true);
    }
    finally {
      this.busy = false;
      this.activeOperation = '';
      this.recordUi('debug', 'UI command buttons unlocked', { requestId, command: name });
    }
  }

  private describe(error: unknown): string {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'TimeoutError') {
      return 'HTTP request timed out. Node may still be processing the MCU command; check Diagnostics and backend terminal.';
    }
    if (error && typeof error === 'object' && 'name' in error && error.name === 'EmptyError') {
      return 'The browser request was cancelled. The MCU may still finish the command.';
    }
    if (error && typeof error === 'object' && 'error' in error) {
      const response = error as { status?: number; statusText?: string; url?: string;
        error?: { error?: string; message?: string; requestId?: string; connected?: boolean; mode?: string } | string };
      const body = response.error;
      const reason = typeof body === 'string' ? body : body?.error || body?.message;
      const http = typeof response.status === 'number' ? `HTTP ${response.status} ${response.statusText || ''} at ${response.url || 'backend'}` : 'Backend request failed';
      const trace = typeof body === 'object' && body?.requestId ? ` [request ${body.requestId}]` : '';
      const state = typeof body === 'object' && typeof body?.connected === 'boolean'
        ? ` (backend connected=${body.connected}, mode=${body.mode || 'unknown'})` : '';
      return `${http}${trace}${reason ? `: ${reason}` : response.status === 0 ? ': backend unavailable, blocked, or connection dropped' : ''}${state}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}

