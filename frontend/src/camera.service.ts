import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, takeUntil, timeout } from 'rxjs';

export type Transport = 'usb' | 'tcp' | 'http' | 'bluetooth';
export interface ConnectionStatus { connected: boolean; mode: Transport; port?: string; host?: string }
export interface SerialPortInfo { path: string; manufacturer: string }
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
export interface DiagnosticEntry {
  id: number;
  time: string;
  level: DiagnosticLevel;
  source: string;
  message: string;
  details: Record<string, unknown>;
}
export interface DiagnosticBatch { entries: DiagnosticEntry[]; latestId: number }
export interface CameraInfo {
  ok: boolean;
  cmd: string;
  cameraReady: boolean;
  board: string;
  format: string;
  psram: boolean;
  sensorPid?: number;
  frameSizeCode?: number;
  jpegQuality?: number;
}
export interface FirmwareTestReport {
  ok: boolean;
  cmd: 't';
  passed: boolean;
  checks: {
    cameraInitialized: boolean;
    sensorDetected: boolean;
    frameCaptured: boolean;
    jpegMarkersValid: boolean;
  };
  details: {
    wifiConfigured: boolean;
    wifiConnected: boolean;
    psramPresent: boolean;
    freeHeapBytes: number;
    frameBytes: number;
  };
}

@Injectable({ providedIn: 'root' })
export class CameraService {
  private readonly http = inject(HttpClient);
  private readonly cancelled = new Subject<void>();

  // Cancels the browser's pending requests; a firmware operation may still be
  // running on Node. The next request uses a fresh subscription as normal.
  cancelPending(): void { this.cancelled.next(); }

  private limited<T>(request: Observable<T>, milliseconds: number): Observable<T> {
    return request.pipe(timeout({ first: milliseconds }), takeUntil(this.cancelled));
  }

  status(): Observable<ConnectionStatus> {
    return this.limited(this.http.get<ConnectionStatus>('/api/status'), 8000);
  }
  ports(): Observable<SerialPortInfo[]> {
    return this.limited(this.http.get<SerialPortInfo[]>('/api/ports'), 8000);
  }
  connect(config: { mode: Transport; port?: string; host?: string }): Observable<ConnectionStatus> {
    return this.limited(this.http.post<ConnectionStatus>('/api/connect', config), 15000);
  }
  disconnect(): Observable<ConnectionStatus> {
    return this.limited(this.http.post<ConnectionStatus>('/api/disconnect', {}), 8000);
  }
  info(): Observable<CameraInfo> { return this.limited(this.http.get<CameraInfo>('/api/info'), 25000); }
  selfTest(): Observable<FirmwareTestReport> {
    return this.limited(this.http.get<FirmwareTestReport>('/api/test'), 25000);
  }
  capture(): Observable<Blob> {
    return this.limited(this.http.get('/api/capture', { responseType: 'blob' }), 30000);
  }
  logs(since = 0): Observable<DiagnosticBatch> {
    return this.limited(this.http.get<DiagnosticBatch>('/api/logs', {
      params: { since: String(since) }
    }), 8000);
  }
  clearLogs(): Observable<DiagnosticBatch> {
    return this.limited(this.http.post<DiagnosticBatch>('/api/logs/clear', {}), 8000);
  }
}

