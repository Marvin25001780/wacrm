import { describe, expect, it } from 'vitest';

import { aggregateCallbacks, aggregateCalls, type ReportCallRow } from './reports';
import {
  buildAgentsCsv,
  buildCallbacksCsv,
  buildCallsCsv,
  buildSummaryCsv,
  businessDateTime,
  csvCell,
  csvDocument,
  exportFileName,
  isExportDataset,
  secondsCell,
} from './export';

const NOW = new Date('2026-11-19T15:00:00Z').getTime();

describe('exportación CSV (sin migración)', () => {
  it('escapa separador, comillas y saltos de línea', () => {
    expect(csvCell('simple')).toBe('simple');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
    expect(csvCell('dos;tres')).toBe('"dos;tres"');
    expect(csvCell('dice "hola"')).toBe('"dice ""hola"""');
    expect(csvCell('linea\nnueva')).toBe('"linea\nnueva"');
  });

  it('neutraliza fórmulas de Excel sin tocar teléfonos', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    // Los teléfonos se dejan tal cual: el usuario los quiere leer.
    expect(csvCell('+584121234567')).toBe('+584121234567');
  });

  it('arma el documento con BOM y CRLF', () => {
    const doc = csvDocument(['A', 'B'], [[1, 'x;y']]);
    expect(doc.startsWith('\uFEFF')).toBe(true);
    expect(doc).toBe('\uFEFFA;B\r\n1;"x;y"');
  });

  it('convierte fechas a hora de Venezuela', () => {
    // 13:00 UTC = 09:00 en Caracas.
    expect(businessDateTime('2026-11-19T13:00:00Z')).toBe('2026-11-19 09:00');
    expect(businessDateTime('2026-11-19T03:30:00Z')).toBe('2026-11-18 23:30');
    expect(businessDateTime(null)).toBe('');
    expect(businessDateTime('no-es-fecha')).toBe('');
  });

  it('deja vacíos los segundos desconocidos', () => {
    expect(secondsCell(null)).toBe('');
    expect(secondsCell(undefined)).toBe('');
    expect(secondsCell(12.6)).toBe('13');
    expect(secondsCell(-5)).toBe('0');
  });

  it('exporta las llamadas con etiquetas y espera solo en entrantes', () => {
    const rows: ReportCallRow[] = [
      {
        direction: 'inbound',
        status: 'ended',
        started_at: '2026-11-19T13:00:00Z',
        answered_at: '2026-11-19T13:00:20Z',
        ended_at: '2026-11-19T13:02:20Z',
        duration_seconds: 120,
        agent_user_id: 'agent-a',
        disposition: 'sale',
        recording_url: 'https://example.com/a.ogg',
        transcript_status: 'done',
      },
      {
        direction: 'outbound',
        status: 'missed',
        started_at: '2026-11-19T14:00:00Z',
        answered_at: null,
        ended_at: null,
        duration_seconds: null,
        agent_user_id: 'agent-b',
        disposition: null,
      },
    ];

    const csv = buildCallsCsv([
      {
        ...rows[0],
        from_number: '+584121111111',
        to_number: '+584140000000',
        contact_name: 'Ana',
        agent_name: 'Luis',
      },
      {
        ...rows[1],
        from_number: '+584140000000',
        to_number: '+584122222222',
        contact_name: null,
        agent_name: 'Luis',
      },
    ]);

    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines[0]).toBe(
      'Inicio (VE);Dirección;Estado;Desde;Hacia;Contacto;Agente;Espera (s);Duración (s);Disposición;Grabación;Transcripción;Fin (VE)'
    );
    expect(lines[1]).toBe(
      '2026-11-19 09:00;Entrante;Finalizada;+584121111111;+584140000000;Ana;Luis;20;120;Venta;Sí;Transcrita;2026-11-19 09:02'
    );
    // Saliente: sin espera y sin grabación ni disposición.
    expect(lines[2]).toBe(
      '2026-11-19 10:00;Saliente;Perdida;+584140000000;+584122222222;;Luis;;;;No;;'
    );
  });

  it('exporta devoluciones con el SLA calculado', () => {
    const csv = buildCallbacksCsv([
      {
        status: 'done',
        reason: 'missed',
        created_at: '2026-11-19T13:00:00Z',
        claimed_at: '2026-11-19T13:10:00Z',
        completed_at: '2026-11-19T13:25:00Z',
        completed_by: 'agent-a',
        assigned_user_id: 'agent-a',
        source_call_id: 'call-1',
        phone: '+584121234567',
        note: 'Pidió llamada;tarde',
        contact_name: 'Ana',
        agent_name: 'Luis',
        completed_by_name: 'Luis',
      },
      {
        status: 'pending',
        reason: 'manual',
        created_at: '2026-11-19T14:00:00Z',
        claimed_at: null,
        completed_at: null,
        completed_by: null,
        assigned_user_id: null,
        source_call_id: null,
        phone: '+584129999999',
        note: null,
        contact_name: null,
        agent_name: null,
      },
    ]);

    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines[1]).toBe(
      '2026-11-19 09:00;Atendida;Llamada perdida;+584121234567;Ana;Luis;2026-11-19 09:10;Luis;2026-11-19 09:25;600;1500;A tiempo;"Pidió llamada;tarde";call-1'
    );
    expect(lines[2]).toContain('Sin reclamar');
    expect(lines[2]).toContain('Registrada a mano');
  });

  it('exporta el desempeño por agente y el resumen', () => {
    const report = aggregateCalls(
      [
        {
          direction: 'inbound',
          status: 'ended',
          started_at: '2026-11-19T13:00:00Z',
          answered_at: '2026-11-19T13:00:10Z',
          ended_at: '2026-11-19T13:01:10Z',
          duration_seconds: 60,
          agent_user_id: 'agent-a',
          disposition: 'sale',
        },
      ],
      {
        days: 1,
        now: NOW,
        roster: [
          { user_id: 'agent-a', name: 'Luis', role: 'agent' },
          { user_id: 'agent-b', name: 'Ana', role: 'viewer' },
        ],
      }
    );

    const agents = buildAgentsCsv(report).replace('\uFEFF', '').split('\r\n');
    expect(agents[0]).toBe(
      'Agente;Rol;Llamadas;Contestadas;Perdidas;Tiempo hablado (s);Duración media (s);QA;Evaluaciones QA;QA IA;Evaluaciones IA'
    );
    expect(agents[1]).toBe('Luis;Agente;1;1;0;60;60;;0;;0');
    expect(agents[2]).toBe('Ana;Espectador;0;0;0;0;;;0;;0');

    const callbacks = aggregateCallbacks([], { now: NOW });
    const summary = buildSummaryCsv(report, callbacks)
      .replace('\uFEFF', '')
      .split('\r\n');
    expect(summary[0]).toBe('Indicador;Valor');
    expect(summary).toContain('Llamadas;1');
    expect(summary).toContain('Contestadas;1');
    expect(summary).toContain('Nivel de servicio;100%');
    expect(summary).toContain('Devoluciones;0');
    expect(summary).toContain('Objetivo SLA devolución (s);1800');
  });

  it('valida el conjunto y arma el nombre del archivo', () => {
    expect(isExportDataset('calls')).toBe(true);
    expect(isExportDataset('agents')).toBe(true);
    expect(isExportDataset('otro')).toBe(false);

    expect(exportFileName('calls', { days: 7, day: '2026-11-19' })).toBe(
      'reporte-llamadas-2026-11-19-7d.csv'
    );
    expect(exportFileName('summary', { days: 0, day: '' })).toBe(
      'reporte-resumen-reporte-1d.csv'
    );
  });
});
