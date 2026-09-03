import { describe, expect, it } from 'vitest';
import {
  armarRenglones,
  calcularRecargoMora,
  clasificarAnomaliasFacturacion,
  componerNumeroFactura,
  componerTotal,
} from '../../src/core/facturacion';
import type { Tarifa } from '../../src/core/tarifas';

const tarifaEstrato3: Tarifa = {
  cargoFijo: 5000,
  limiteBasicoM3: 22,
  precioBasicoM3: 1200,
  precioNoBasicoM3: 2400,
};

const tarifaFija: Tarifa = { cargoFijo: 45000, limiteBasicoM3: 0, precioBasicoM3: 0, precioNoBasicoM3: 0 };

function mapaTarifas(entries: Array<[string, Tarifa]>): Map<string, Tarifa> {
  return new Map(entries);
}

describe('armarRenglones (punto 10: mismo consumo para todos los servicios)', () => {
  const servicios = [
    { id: 'srv-acueducto', nombre: 'Acueducto', tipoCalculo: 'por_consumo' as const },
    { id: 'srv-alcantarillado', nombre: 'Alcantarillado', tipoCalculo: 'por_consumo' as const },
    { id: 'srv-aseo', nombre: 'Aseo', tipoCalculo: 'fijo' as const },
  ];

  it('genera un renglón por servicio activo sobre el MISMO consumo, ignorando los sin tarifa', () => {
    const r = armarRenglones({
      servicios,
      tarifasVigentes: mapaTarifas([
        ['srv-acueducto', tarifaEstrato3],
        ['srv-alcantarillado', { ...tarifaEstrato3, cargoFijo: 3000, precioBasicoM3: 900, precioNoBasicoM3: 1800 }],
        // 'srv-aseo' SIN tarifa → no genera renglón
      ]),
      tarifasIds: new Map([
        ['srv-acueducto', 'tarifa-a1'],
        ['srv-alcantarillado', 'tarifa-a2'],
      ]),
      consumoM3: 25,
    });
    expect(r).toHaveLength(2);
    expect(r[0]!.servicioId).toBe('srv-acueducto');
    expect(r[1]!.servicioId).toBe('srv-alcantarillado');
    expect(r[0]!.consumoM3).toBe(25);
    expect(r[1]!.consumoM3).toBe(25); // mismo consumo
  });

  it('consumo en el límite exacto y límite ±1 (D-1, INCLUSIVO) a través del subtotal', () => {
    const tarifas = mapaTarifas([['srv-acueducto', tarifaEstrato3]]);
    const ids = new Map([['srv-acueducto', 'tarifa-a1']]);
    const srv = [servicios[0]!];

    const limExacto = armarRenglones({ servicios: srv, tarifasVigentes: tarifas, tarifasIds: ids, consumoM3: 22 });
    // 22 m³ al precio básico: 5000 + 22*1200 = 31400
    expect(limExacto[0]!.subtotal).toBe(31400);
    expect(limExacto[0]!.consumoBasicoM3).toBe(22);
    expect(limExacto[0]!.consumoNoBasicoM3).toBe(0);

    const limMenos = armarRenglones({ servicios: srv, tarifasVigentes: tarifas, tarifasIds: ids, consumoM3: 21 });
    expect(limMenos[0]!.subtotal).toBe(30200); // 5000 + 21*1200

    const limMas = armarRenglones({ servicios: srv, tarifasVigentes: tarifas, tarifasIds: ids, consumoM3: 23 });
    // 22 básicos + 1 no básico: 5000 + 22*1200 + 1*2400 = 33800
    expect(limMas[0]!.subtotal).toBe(33800);
    expect(limMas[0]!.consumoBasicoM3).toBe(22);
    expect(limMas[0]!.consumoNoBasicoM3).toBe(1);
  });

  it('servicio fijo ignora el consumo y devuelve el cargo fijo', () => {
    const r = armarRenglones({
      servicios: [{ id: 'srv-aseo', nombre: 'Aseo', tipoCalculo: 'fijo' }],
      tarifasVigentes: mapaTarifas([['srv-aseo', tarifaFija]]),
      tarifasIds: new Map([['srv-aseo', 'tarifa-aseo']]),
      consumoM3: 999,
    });
    expect(r[0]!.subtotal).toBe(45000);
    expect(r[0]!.consumoM3).toBe(0);
  });
});

describe('calcularRecargoMora (punto 11: sobre el saldo vencido del MISMO suscriptor)', () => {
  it('sin deuda vencida → 0', () => {
    expect(calcularRecargoMora(2, 0)).toBe(0);
  });

  it('porcentaje 0 → 0', () => {
    expect(calcularRecargoMora(0, 50000)).toBe(0);
  });

  it('2% sobre 100.000 → 2.000 (redondeado a la unidad)', () => {
    expect(calcularRecargoMora(2, 100000)).toBe(2000);
  });

  it('2% sobre 10.000 → 200', () => {
    expect(calcularRecargoMora(2, 10000)).toBe(200);
  });
});

describe('componerTotal (§2.9)', () => {
  it('total = subtotal_servicios + recargo_mora + saldo_anterior', () => {
    expect(componerTotal({ subtotalServicios: 38600, recargoMora: 200, saldoAnterior: 15000 })).toBe(53800);
  });

  it('sin saldo anterior ni mora', () => {
    expect(componerTotal({ subtotalServicios: 38600, recargoMora: 0, saldoAnterior: 0 })).toBe(38600);
  });
});

describe('componerNumeroFactura (D-3)', () => {
  it('formato {prefijo}-{YYYY}-{NNNNN} con 5 dígitos', () => {
    expect(componerNumeroFactura('FAC', 2026, 347)).toBe('FAC-2026-00347');
  });

  it('consecutivo pequeño se rellena a 5 dígitos', () => {
    expect(componerNumeroFactura('REC', 2026, 3)).toBe('REC-2026-00003');
  });

  it('el reinicio anual se refleja pasando un anio distinto y consecutivo desde 1', () => {
    expect(componerNumeroFactura('FAC', 2027, 1)).toBe('FAC-2027-00001');
  });
});

describe('clasificarAnomaliasFacturacion (spec §3.3)', () => {
  const base = {
    usuarioServicioId: 'd0000000-0000-0000-0000-0000000000a1',
    tieneLectura: true,
    revisionLectura: 'normal' as const,
    tieneTarifa: true,
    total: 38600,
    totalPeriodoAnterior: null,
  };

  it('caso sano: sin anomalías', () => {
    expect(clasificarAnomaliasFacturacion(base)).toEqual([]);
  });

  it('sin lectura → usuario_sin_lectura', () => {
    const a = clasificarAnomaliasFacturacion({ ...base, tieneLectura: false });
    expect(a.map((x) => x.tipo)).toContain('usuario_sin_lectura');
  });

  it('lectura atípica (consumo alto/bajo/cero) → consumo_atipico', () => {
    const a = clasificarAnomaliasFacturacion({ ...base, revisionLectura: 'consumo_alto' });
    expect(a.map((x) => x.tipo)).toContain('consumo_atipico');
  });

  it('sin tarifa configurada → sin_tarifa (regla 9d, no se emite)', () => {
    const a = clasificarAnomaliasFacturacion({ ...base, tieneTarifa: false });
    expect(a.map((x) => x.tipo)).toContain('sin_tarifa');
  });

  it('total <= 0 → total_cero_o_negativo', () => {
    const a = clasificarAnomaliasFacturacion({ ...base, total: 0 });
    expect(a.map((x) => x.tipo)).toContain('total_cero_o_negativo');
  });

  it('variación vs periodo anterior > 20% → variacion_superior_20', () => {
    const a = clasificarAnomaliasFacturacion({ ...base, total: 50000, totalPeriodoAnterior: 30000 });
    expect(a.map((x) => x.tipo)).toContain('variacion_superior_20');
  });

  it('variación <= 20% no dispara anomalía', () => {
    const a = clasificarAnomaliasFacturacion({ ...base, total: 34000, totalPeriodoAnterior: 30000 });
    expect(a.map((x) => x.tipo)).not.toContain('variacion_superior_20');
  });
});

