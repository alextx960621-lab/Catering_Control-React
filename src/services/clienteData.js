import config from './config';
import { rpc, getPortalCatalog, dbGetClientRow, dbSaveOwnClientProfile } from './supabaseClient';
import { writeCachedBranding, writeClientRow } from './clienteStorage';

// Trae el branding (nombre, logo, whatsapp, ítems del menú, etc.) desde
// Supabase y lo deja en caché para la próxima carga.
export async function fetchBrandingRemote() {
  const settings = await rpc('get_branding', {});
  if (!settings) return null;
  const branding = {
    companyName: settings.companyName,
    logoUrl: settings.logoUrl,
    itemIcons: settings.itemIcons || {},
    whatsappNumber: settings.whatsappNumber,
    instagramUrl: settings.instagramUrl,
    instagramHandle: settings.instagramHandle,
    adImageUrl: settings.adImageUrl,
    paymentQrUrl: settings.paymentQrUrl,
    renewalWarningDays: settings.renewalWarningDays,
    menuItems: (settings.menuItems || []).map((m) => [m.key, m.label]),
  };
  writeCachedBranding(branding);
  return branding;
}

// El portal cliente es una función Premium: esta función chequea si la
// empresa tiene el plan que lo desbloquea.
export async function fetchIsPremium() {
  const info = await rpc('get_plan_status', {});
  if (!info) return false;
  const isPremiumPlan = info?.plan === 'premium';
  const locked =
    'clientPortalLocked' in info
      ? !!info.clientPortalLocked
      : info.premiumLockedPages && 'clientPortal' in info.premiumLockedPages
        ? !!info.premiumLockedPages.clientPortal
        : true;
  return isPremiumPlan || !locked;
}

// Trae, en paralelo, el catálogo (planes/calendario) y la fila del
// cliente ya actualizados — se llama después de mostrar el portal con
// los datos locales, para refrescar en segundo plano.
export async function fetchServerSync(clientId) {
  const [remoteMeta, remoteClient] = await Promise.all([getPortalCatalog(), dbGetClientRow(clientId)]);
  return { remoteMeta, remoteClient };
}

// Guarda los cambios que el cliente hace sobre su propio perfil (pausa,
// reactivación, dirección). Solo estos campos viajan; el servidor de
// todos modos ignora cualquier otro campo que llegue.
export async function saveClient(updatedClient) {
  writeClientRow(updatedClient);
  const { pauseStart, returnDate, status, pauseDates, activeAddressId } = updatedClient;
  return dbSaveOwnClientProfile(updatedClient.id, { pauseStart, returnDate, status, pauseDates, activeAddressId });
}

export { config };
