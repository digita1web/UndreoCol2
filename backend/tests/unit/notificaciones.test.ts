import { describe, expect, it } from 'vitest';
import {
  computarActualizacionNotificacion,
  contenidoAvisoMora,
  contenidoConfirmacionPago,
  contenidoCorteEjecutado,
  contenidoReconexionCompletada,
  contenidoRecordatorioVencimiento,
  escaparHtml,
} from '../../src/core/notificaciones';

describe('computarActualizacionNotificacion (trazabilidad del fallo, spec §3.4) — movido desde email.test.ts (010)', () => {
  it('envío fallido: incrementa intentos y deja ultimo_error poblado (sigue pendiente para reintento)', () => {
    const r = computarActualizacionNotificacion({ ok: false, error: 'EMAIL no está configurado (dev)' }, 0);
    expect(r.intentos).toBe(1);
    expect(r.estado).toBe('pendiente');
    expect(r.ultimo_error).toContain('EMAIL no está configurado');
  });

  it('envío exitoso: estado enviada con intentos incrementado y enviada_en', () => {
    const r = computarActualizacionNotificacion({ ok: true }, 0);
    expect(r.intentos).toBe(1);
    expect(r.estado).toBe('enviada');
    expect(r.enviada_en).toBeTruthy();
    expect(r.ultimo_error).toBeUndefined();
  });

  it('tras agotar los reintentos (3) el estado pasa a fallida (el admin lo gestiona)', () => {
    const r = computarActualizacionNotificacion({ ok: false, error: 'E_RATE_LIMIT_EXCEEDED' }, 2);
    expect(r.intentos).toBe(3);
    expect(r.estado).toBe('fallida');
    expect(r.ultimo_error).toContain('E_RATE_LIMIT_EXCEEDED');
  });
});

describe('contenido* — asunto y cuerpo por tipo de notificación (spec §3.2)', () => {
  it('contenidoRecordatorioVencimiento incluye número, fecha y total', () => {
    const c = contenidoRecordatorioVencimiento({
      nombreAcueducto: 'Acueducto A',
      numeroFactura: 'FAC-2026-00001',
      fechaVencimiento: '2026-09-20',
      total: 45000,
    });
    expect(c.asunto).toContain('FAC-2026-00001');
    expect(c.asunto).toContain('2026-09-20');
    expect(c.cuerpoHtml).toContain('FAC-2026-00001');
    expect(c.cuerpoHtml).toContain('Acueducto A');
    expect(c.cuerpoHtml).toContain('45000');
    expect(c.cuerpoHtml).toContain('2026-09-20');
  });

  it('contenidoAvisoMora incluye número, días de mora y total', () => {
    const c = contenidoAvisoMora({
      nombreAcueducto: 'Acueducto A',
      numeroFactura: 'FAC-2026-00002',
      diasMora: 5,
      total: 30000,
    });
    expect(c.asunto).toContain('FAC-2026-00002');
    expect(c.cuerpoHtml).toContain('FAC-2026-00002');
    expect(c.cuerpoHtml).toContain('5 día');
    expect(c.cuerpoHtml).toContain('30000');
  });

  it('contenidoConfirmacionPago lista las facturas aplicadas', () => {
    const c = contenidoConfirmacionPago({
      nombreAcueducto: 'Acueducto A',
      valor: 20000,
      fechaPago: '2026-09-05',
      facturasAplicadas: ['FAC-2026-00001', 'FAC-2026-00002'],
    });
    expect(c.cuerpoHtml).toContain('20000');
    expect(c.cuerpoHtml).toContain('2026-09-05');
    expect(c.cuerpoHtml).toContain('FAC-2026-00001');
    expect(c.cuerpoHtml).toContain('FAC-2026-00002');
  });

  it('contenidoConfirmacionPago sin facturas aplicadas (todo a saldo a favor, regla 14)', () => {
    const c = contenidoConfirmacionPago({
      nombreAcueducto: 'Acueducto A',
      valor: 10000,
      fechaPago: '2026-09-05',
      facturasAplicadas: [],
    });
    expect(c.cuerpoHtml).toContain('saldo a favor');
  });

  it('contenidoCorteEjecutado incluye el motivo y la fecha', () => {
    const c = contenidoCorteEjecutado({
      nombreAcueducto: 'Acueducto A',
      motivo: 'Mora superior a 60 días',
      fecha: '2026-09-05',
    });
    expect(c.cuerpoHtml).toContain('Mora superior a 60 días');
    expect(c.cuerpoHtml).toContain('2026-09-05');
  });

  it('contenidoReconexionCompletada menciona la factura de reconexión si existe', () => {
    const c = contenidoReconexionCompletada({
      nombreAcueducto: 'Acueducto A',
      fecha: '2026-09-05',
      facturaReconexionNumero: 'REC-2026-00001',
    });
    expect(c.cuerpoHtml).toContain('REC-2026-00001');
  });

  it('contenidoReconexionCompletada sin número de factura disponible (defensivo — 009 siempre genera una, regla 19)', () => {
    const c = contenidoReconexionCompletada({
      nombreAcueducto: 'Acueducto A',
      fecha: '2026-09-05',
      facturaReconexionNumero: null,
    });
    expect(c.cuerpoHtml).not.toContain('null');
    expect(c.cuerpoHtml).toContain('reconectado');
  });
});

// ---------------------------------------------------------------------------
// Escape de HTML en los cuerpos de correo (fix de la auditoría de seguridad
// pre-producción, docs/PLAN-PRODUCCION.md — hallazgo WARNING de Semgrep
// confirmado como real). `nombreAcueducto` (POST /onboarding) y `motivo` del
// corte son texto libre que escribe una persona; sin escapar permiten inyectar
// marcado en un correo que el suscriptor recibe como legítimo.
// ---------------------------------------------------------------------------
describe('escaparHtml — inyección de HTML en el correo del suscriptor', () => {
  it('escapa los cinco caracteres de contexto HTML sin re-escapar entidades', () => {
    expect(escaparHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('escapa & primero: no produce entidades dobles', () => {
    expect(escaparHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });

  it('acepta números (los valores de dinero y días se interpolan igual)', () => {
    expect(escaparHtml(38600)).toBe('38600');
  });

  it('deja intacto el texto normal con tildes y ñ', () => {
    expect(escaparHtml('Acueducto La Peña')).toBe('Acueducto La Peña');
  });

  const PHISHING = '<a href="https://pagos-falsos.example">Pague aquí ahora</a>';

  it('corte ejecutado: el motivo escrito por el admin no inyecta marcado', () => {
    const { cuerpoHtml } = contenidoCorteEjecutado({
      nombreAcueducto: 'Acueducto A',
      motivo: PHISHING,
      fecha: '2026-09-07',
    });
    expect(cuerpoHtml).not.toContain('<a href');
    expect(cuerpoHtml).toContain('&lt;a href=&quot;https://pagos-falsos.example&quot;&gt;');
  });

  it('corte ejecutado: el nombre del acueducto tampoco inyecta marcado', () => {
    const { cuerpoHtml } = contenidoCorteEjecutado({
      nombreAcueducto: PHISHING,
      motivo: 'Mora superior a 60 días',
      fecha: '2026-09-07',
    });
    expect(cuerpoHtml).not.toContain('<a href');
  });

  it('recordatorio de vencimiento: el nombre del acueducto se escapa', () => {
    const { cuerpoHtml } = contenidoRecordatorioVencimiento({
      nombreAcueducto: PHISHING,
      numeroFactura: 'FAC-2026-00001',
      fechaVencimiento: '2026-10-02',
      total: 38600,
    });
    expect(cuerpoHtml).not.toContain('<a href');
    expect(cuerpoHtml).toContain('<strong>FAC-2026-00001</strong>'); // el marcado propio sí queda
  });

  it('aviso de mora: el nombre del acueducto se escapa', () => {
    const { cuerpoHtml } = contenidoAvisoMora({
      nombreAcueducto: PHISHING,
      numeroFactura: 'FAC-2026-00001',
      diasMora: 12,
      total: 38600,
    });
    expect(cuerpoHtml).not.toContain('<a href');
  });

  it('confirmación de pago: los números de factura aplicados se escapan uno a uno', () => {
    const { cuerpoHtml } = contenidoConfirmacionPago({
      nombreAcueducto: 'Acueducto A',
      valor: 50000,
      fechaPago: '2026-09-07',
      facturasAplicadas: ['FAC-2026-00001', PHISHING],
    });
    expect(cuerpoHtml).not.toContain('<a href');
    expect(cuerpoHtml).toContain('FAC-2026-00001');
  });

  it('reconexión completada: nombre y número de factura de reconexión se escapan', () => {
    const { cuerpoHtml } = contenidoReconexionCompletada({
      nombreAcueducto: PHISHING,
      fecha: '2026-09-07',
      facturaReconexionNumero: PHISHING,
    });
    expect(cuerpoHtml).not.toContain('<a href');
  });

  it('el asunto NO se escapa (es texto plano de cabecera, no HTML)', () => {
    const { asunto } = contenidoCorteEjecutado({
      nombreAcueducto: 'Acueducto & Cía',
      motivo: 'Mora',
      fecha: '2026-09-07',
    });
    expect(asunto).toContain('Acueducto & Cía');
  });
});
