import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOperations } from '../../../context/OperationsContext';
import { n } from '../../../services/planHelpers';
import { isPagePremiumLocked } from '../../../services/panelAuth';
import { dbSendManualPush } from '../../../services/supabaseClient';
import ImageField from '../ImageField';
import PremiumPageLock from '../PremiumPageLock';
import ReminderCard from './ReminderCard';

const FILTERS = [
  ['all', 'filterAll'],
  ['tenure', 'filterTenure'],
  ['expiring', 'filterExpiring'],
  ['subscribedAll', 'filterSubscribedAll'],
];

export default function PublicidadPage() {
  const { t } = useTranslation();
  const { settings, saveSettings, clients, showNotice } = useOperations();
  const [filter, setFilter] = useState('all');
  const [tenureDays, setTenureDays] = useState(30);
  const [expiringDays, setExpiringDays] = useState(3);
  const [title, setTitle] = useState(() => t('panel.publicidad.defaultTitle'));
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const activeClients = useMemo(() => (clients || []).filter((c) => c.status !== 'Retorno pendiente'), [clients]);
  const isAllSubscribed = filter === 'subscribedAll';
  // Los datos de la empresa (logo, WhatsApp, QR) son Básicos; los avisos —automáticos y…
  // manuales— son Premium. Criterio igual al resto del panel.
  const locked = (page) => isPagePremiumLocked(page, settings.premiumLockedPages) && settings.plan !== 'premium';

  const targetClients = useMemo(() => {
    if (filter === 'tenure') return activeClients.filter((c) => n(c.consumedDays) > n(tenureDays));
    if (filter === 'expiring') {
      return activeClients.filter((c) => {
        const remaining = Math.max(0, n(c.paidDays) - n(c.consumedDays));
        return remaining > 0 && remaining <= n(expiringDays);
      });
    }
    // 'subscribedAll' no filtra por lista de clientes acá -- lo resuelve la Edge Function…
    return activeClients;
  }, [activeClients, filter, tenureDays, expiringDays]);

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      showNotice(t('panel.publicidad.writeTitleBody'), true);
      return;
    }
    if (!isAllSubscribed && !targetClients.length) {
      showNotice(t('panel.publicidad.noClientsMatchFilter'), true);
      return;
    }
    const confirmMsg = isAllSubscribed
      ? t('panel.publicidad.confirmAllSubscribed')
      : t('panel.publicidad.confirmClients', { count: targetClients.length });
    if (!confirm(confirmMsg)) return;

    setSending(true);
    const result = await dbSendManualPush(
      isAllSubscribed ? [] : targetClients.map((c) => c.id),
      title.trim(),
      body.trim(),
      { allSubscribed: isAllSubscribed },
    );
    setSending(false);

    if (!result?.ok) {
      showNotice(result?.error || t('panel.publicidad.sendFailed'), true);
      return;
    }
    showNotice(t('panel.publicidad.sentSummary', { sent: result.sent, failed: result.failed, subscriptionsFound: result.subscriptionsFound }));
  }

  return (
    <section className="p-3">
      <h1 className="h5 mb-3">{t('panel.nav.publicidad')}</h1>

      <div className="settings-grid">
        <div className="card card-pad stack">
          <h3>{t('panel.publicidad.companyDataTitle')}</h3>
          <p className="muted" style={{ marginTop: -6 }}>{t('panel.publicidad.companyDataHint')}</p>
          <ImageField
            label={t('panel.publicidad.logoLabel')}
            name="_logo"
            value={settings.logoUrl}
            onChange={(url) => saveSettings({ ...settings, logoUrl: url })}
            folder="branding"
            maxDim={300}
            hint={t('panel.publicidad.logoHint')}
          />
          <label>{t('panel.publicidad.companyName')}<input defaultValue={settings.companyName} onBlur={(e) => saveSettings({ ...settings, companyName: e.target.value })} /></label>
          <label>{t('panel.publicidad.whatsappNumber')}<input defaultValue={settings.whatsappNumber} placeholder={t('panel.publicidad.whatsappPlaceholder')} onBlur={(e) => saveSettings({ ...settings, whatsappNumber: e.target.value.replace(/\D/g, '') })} /></label>
          <label>{t('panel.publicidad.instagramLink')}<input defaultValue={settings.instagramUrl} placeholder={t('panel.publicidad.instagramPlaceholder')} onBlur={(e) => saveSettings({ ...settings, instagramUrl: e.target.value.trim() })} /></label>
          <label>{t('panel.publicidad.instagramHandle')}<input defaultValue={settings.instagramHandle} placeholder={t('panel.publicidad.instagramHandlePlaceholder')} onBlur={(e) => saveSettings({ ...settings, instagramHandle: e.target.value.trim() })} /></label>
          <ImageField
            label={t('panel.publicidad.adImageLabel')}
            name="_ad"
            value={settings.adImageUrl}
            onChange={(url) => saveSettings({ ...settings, adImageUrl: url })}
            folder="branding"
            maxDim={800}
            aspect="3-2"
            hint={t('panel.publicidad.adImageHint')}
          />
          <ImageField
            label={t('panel.publicidad.qrLabel')}
            name="_qr"
            value={settings.paymentQrUrl}
            onChange={(url) => saveSettings({ ...settings, paymentQrUrl: url })}
            folder="branding"
            maxDim={500}
            hint={t('panel.publicidad.qrHint')}
          />
          <label>{t('panel.publicidad.renewalWarningDays')}
            <input type="number" min="0" max="30" defaultValue={n(settings.renewalWarningDays)} onBlur={(e) => saveSettings({ ...settings, renewalWarningDays: Math.max(0, n(e.target.value)) })} />
          </label>
        </div>

        {locked('autoReminder')
          ? <PremiumPageLock featureLabel={t('panel.reminder.title')} premiumWhatsapp={settings.premiumWhatsapp} />
          : <ReminderCard />}
      </div>

      {locked('manualPush') ? (
        <div style={{ marginTop: 18 }}>
          <PremiumPageLock featureLabel={t('panel.publicidad.manualPushTitle')} premiumWhatsapp={settings.premiumWhatsapp} />
        </div>
      ) : (
      <div className="card card-pad stack" style={{ marginTop: 18 }}>
        <h3>{t('panel.publicidad.manualPushTitle')}</h3>
        <label>{t('panel.publicidad.titleLabel')}<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('panel.publicidad.titlePlaceholder')} /></label>
        <label>{t('panel.publicidad.messageLabel')}<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('panel.publicidad.messagePlaceholder')} /></label>

        <label>{t('panel.publicidad.sendTo')}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map(([key, labelKey]) => <option key={key} value={key}>{t(`panel.publicidad.${labelKey}`)}</option>)}
          </select>
        </label>
        {filter === 'tenure' && (
          <label style={{ maxWidth: 220 }}>{t('panel.publicidad.tenureDaysLabel')}
            <input type="number" min="0" value={tenureDays} onChange={(e) => setTenureDays(e.target.value)} />
          </label>
        )}
        {filter === 'expiring' && (
          <label style={{ maxWidth: 220 }}>{t('panel.publicidad.expiringDaysLabel')}
            <input type="number" min="1" value={expiringDays} onChange={(e) => setExpiringDays(e.target.value)} />
          </label>
        )}

        <p className="muted" style={{ marginBottom: 4 }}>
          {isAllSubscribed
            ? t('panel.publicidad.reachAllHint')
            : <>{t('panel.publicidad.reachPrefix')}<b>{targetClients.length}</b>{' '}{t('panel.publicidad.reachSuffix', { count: targetClients.length })}</>}
        </p>
        <button type="button" className="primary" onClick={handleSend} disabled={sending || !title.trim() || !body.trim()}>
          {sending ? t('panel.publicidad.sending') : t('panel.publicidad.sendNotification')}
        </button>
      </div>
      )}
    </section>
  );
}
