// Cierre automático del día operativo: hace lo mismo que el botón "Procesar día" del Panel.
import { addDays } from './shared/planHelpers.js';
import { lastProcessedDate } from './shared/dispatchHelpers.js';
import { normalizeClient, normalizeSettings, openRoutes } from './shared/normalize.js';
import { planDayClose } from './shared/dayProcessing.js';

const fmt = (d) => d.split('-').reverse().join('/');

// PostgREST devuelve como máximo 1000 filas por consulta: se lee por páginas para no perder clientes
async function leerClientes(admin) {
  const PAGINA = 1000;
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await admin.from('db_clientes_rows').select('id, payload').order('id').range(desde, desde + PAGINA - 1);
    if (error) return { error };
    filas.push(...data);
    if (data.length < PAGINA) return { data: filas };
  }
}

async function cargar(admin) {
  const [fechaR, clientesR, personalR, inventarioR, filasR] = await Promise.all([
    admin.rpc('get_business_date'),
    admin.from('db_clientes').select('id, payload').in('id', ['days', 'plans']),
    admin.from('db_personal').select('id, payload').in('id', ['drivers', 'routes', 'settings']),
    admin.from('db_inventario').select('payload').eq('id', 'main').maybeSingle(),
    leerClientes(admin),
  ]);
  const fallo = [fechaR, clientesR, personalR, inventarioR, filasR].find((r) => r.error);
  if (fallo) throw new Error(`No se pudieron leer los datos: ${fallo.error.message}`);
  const date = String(fechaR.data).slice(0, 10);
  // Las marcas de entrega del día mandan quién paga el servicio (falla del personal no descuenta)
  const entregasR = await admin.from('db_delivery_status').select('client_id, payload').eq('date', date);
  if (entregasR.error) throw new Error(`No se pudieron leer las entregas del día: ${entregasR.error.message}`);
  const byId = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r.payload]));
  const cl = byId(clientesR.data), pe = byId(personalR.data);
  const inventarioRaw = inventarioR.data?.payload ?? null;
  return {
    date,
    daysRaw: cl.days ?? {},
    ctx: {
      days: cl.days ?? {},
      plans: cl.plans || [],
      drivers: pe.drivers || [],
      routes: pe.routes?.length ? pe.routes : openRoutes(),
      settings: normalizeSettings(pe.settings),
      clients: (filasR.data || []).map((r) => normalizeClient({ ...r.payload, id: r.id })),
      inventory: { items: inventarioRaw?.items || [], links: inventarioRaw?.links || [], movements: inventarioRaw?.movements || [] },
      deliveryRows: (entregasR.data || []).map((r) => ({ clientId: r.client_id, ...r.payload })),
    },
    inventarioRaw,
  };
}

async function auditar(admin, action, date, details) {
  const { error } = await admin.from('db_audit_log').insert({
    actor_id: null, actor_name: 'Cierre automático', actor_role: 'sistema',
    action, entity_type: 'day', entity_label: date, entity_id: date, details,
  });
  if (error) console.error('[cerrar-dia-automatico] No se pudo registrar la auditoría:', error);
}

// dryRun=true calcula y devuelve qué haría, sin guardar nada
export async function cerrarDiaAutomatico(admin, { dryRun = false } = {}) {
  for (let intento = 1; intento <= 2; intento++) {
    const { date, daysRaw, ctx, inventarioRaw } = await cargar(admin);
    const { days } = ctx;

    if (days[date]?.processed) return { estado: 'ya_procesado', fecha: date };

    const ultimo = lastProcessedDate(days);
    if (!ultimo) {
      if (!dryRun) await auditar(admin, 'Cierre automático omitido: no hay ningún día procesado todavía', date, {});
      return { estado: 'omitido', motivo: 'sin_historial', fecha: date };
    }
    if (date <= ultimo || date > addDays(ultimo, 1)) {
      const primero = addDays(ultimo, 1);
      if (!dryRun) await auditar(admin, `Cierre automático omitido: primero hay que procesar el ${fmt(primero)}`, date, { ultimoProcesado: ultimo });
      return { estado: 'omitido', motivo: 'dias_pendientes', fecha: date, primeroPendiente: primero };
    }

    const plan = planDayClose({ date, ...ctx });
    const sinDescuento = plan.processedIds.length - plan.chargedIds.length;
    const resumen = {
      fecha: date, laborable: !plan.nonWorking, clientes: plan.processedIds.length, sinDescuento,
      inventario: plan.newInventory ? plan.newInventory.movements.length - ctx.inventory.movements.length : 0,
    };
    if (dryRun) return { estado: 'simulacion', ...resumen, clienteIds: plan.processedIds, clienteIdsDescontados: plan.chargedIds };

    const { data, error } = await admin.rpc('_cerrar_dia_aplicar', {
      p: {
        date, expected_days: daysRaw, new_days: plan.newDays,
        charged_ids: plan.chargedIds,
        expected_inventory: plan.newInventory ? inventarioRaw : null, new_inventory: plan.newInventory,
        snapshot: plan.snapshot,
        audit: {
          action: plan.nonWorking ? 'Día cerrado automáticamente (no laborable)' : 'Día procesado automáticamente',
          details: { clientesAtendidos: plan.processedIds.length, sinDescuentoServicio: sinDescuento || undefined, hora: '22:00' },
        },
      },
    });
    if (!error && data?.ok) return { estado: 'ok', ...resumen };
    // Alguien tocó los días mientras tanto: se recalcula una vez con datos frescos
    if (!error && data?.reason === 'days_changed' && intento === 1) continue;
    const motivo = error ? error.message : data?.reason || 'desconocido';
    await auditar(admin, `Cierre automático falló: ${motivo}`, date, {});
    return { estado: 'error', motivo, fecha: date };
  }
  return { estado: 'error', motivo: 'reintentos_agotados' };
}
