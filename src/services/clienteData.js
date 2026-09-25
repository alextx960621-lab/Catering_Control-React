import { rpc, getPortalCatalog, dbGetClientRow, dbSaveOwnClientProfile } from './supabaseClient';
import { writeCachedBranding, writeClientRow, writeCachedIsPremium } from './clienteStorage';

// Trae el branding (nombre, logo, whatsapp, ítems del menú, etc.) desde Supabase y lo deja…
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

// El portal cliente es una función Premium: esta función chequea si la empresa tiene el…
export async function fetchIsPremium() {
  const info = await rpc('get_plan_status', {});
  if (!info) return null; // sin red: ni true ni false, "no se pudo saber"
  const isPremiumPlan = info?.plan === 'premium';
  const locked =
    'clientPortalLocked' in info
      ? !!info.clientPortalLocked
      : info.premiumLockedPages && 'clientPortal' in info.premiumLockedPages
        ? !!info.premiumLockedPages.clientPortal
        : true;
  const result = isPremiumPlan || !locked;
  writeCachedIsPremium(result);
  return result;
}

// Trae, en paralelo, el catálogo (planes/calendario) y la fila del cliente ya actualizados…
export async function fetchServerSync(clientId) {
  const [remoteMeta, remoteClient] = await Promise.all([getPortalCatalog(), dbGetClientRow(clientId)]);
  return { remoteMeta, remoteClient };
}

// Guarda los cambios que el cliente hace sobre su propio perfil (pausa, reactivación…
export async function saveClient(updatedClient) {
  writeClientRow(updatedClient);
  const { pauseStart, returnDate, status, pauseDates, activeAddressId } = updatedClient;
  return dbSaveOwnClientProfile(updatedClient.id, { pauseStart, returnDate, status, pauseDates, activeAddressId });
}
