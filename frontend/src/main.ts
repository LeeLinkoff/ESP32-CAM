import { bootstrapApplication } from '@angular/platform-browser';
import { HttpErrorResponse, HttpInterceptorFn, HttpResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { catchError, finalize, tap, throwError } from 'rxjs';
import { AppComponent } from './app.component';

// Trace the actual browser HTTP lifecycle independently of CameraService.
// This lets the UI distinguish an HTTP response from a completed MCU command.
const httpTraceInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.url.startsWith('/api/logs')) return next(request); // Avoid polling noise.
  const started = performance.now();
  const details = { method: request.method, url: request.url };
  const trace = (level: 'info' | 'debug' | 'error', message: string, extra: Record<string, unknown> = {}): void => {
    window.dispatchEvent(new CustomEvent('esp32cam-http-trace', {
      detail: { level, message, details: { ...details, ...extra } }
    }));
  };

  trace('info', 'HTTP request sent by Angular', details);
  return next(request).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) {
        trace('info', 'HTTP response received by Angular', {
          status: event.status,
          requestId: event.headers.get('X-Request-ID') || 'not supplied by backend',
          elapsedMs: Math.round(performance.now() - started),
          connected: event.body && typeof event.body === 'object' && 'connected' in event.body
            ? event.body.connected : undefined
        });
      }
    }),
    catchError((error: unknown) => {
      const httpError = error instanceof HttpErrorResponse ? error : null;
      const response = httpError?.error;
      trace('error', 'HTTP request failed in Angular', {
        status: httpError?.status ?? 'not an HTTP response',
        requestId: httpError?.headers.get('X-Request-ID') || response?.requestId || 'not supplied',
        error: typeof response?.error === 'string' ? response.error : (error instanceof Error ? error.message : String(error)),
        elapsedMs: Math.round(performance.now() - started)
      });
      return throwError(() => error);
    }),
    finalize(() => {
      trace('debug', 'Angular HTTP request finalized (complete or cancelled)', {
        elapsedMs: Math.round(performance.now() - started)
      });
    })
  );
};

// Angular 21 runs zoneless; component signals schedule all async UI updates.
bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([httpTraceInterceptor]))
  ]
})
  .catch((error) => console.error(error));

