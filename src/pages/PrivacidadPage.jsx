import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import './LegalPage.css';
import { usePageBodyClass } from '../hooks/usePageBodyClass';
import { useTheme } from '../hooks/useTheme';
import LegalBackButton from '../components/LegalBackButton';

export default function PrivacidadPage() {
  const { t } = useTranslation();
  useTheme();
  usePageBodyClass('page-legal');
  return (
    <div className="legal-wrap">
      <LegalBackButton />
      <div className="legal-card">
        <h1>{t('legal.privacy.title')}</h1>
        <p className="legal-updated">{t('legal.updated')}</p>

        <Trans
          i18nKey="legal.privacy.intro"
          components={{ 0: <b /> }}
        />

        <h2>1. {t('legal.privacy.t1')}</h2>
        <div className="legal-table-scroll">
          <table>
            <tbody>
              <tr><th>{t('legal.privacy.tableWho')}</th><th>{t('legal.privacy.tableWhat')}</th></tr>
              <tr><td>{t('legal.privacy.rowClients')}</td><td>{t('legal.privacy.rowClientsData')}</td></tr>
              <tr><td>{t('legal.privacy.rowStaff')}</td><td>{t('legal.privacy.rowStaffData')}</td></tr>
              <tr><td>{t('legal.privacy.rowDrivers')}</td><td>{t('legal.privacy.rowDriversData')}</td></tr>
            </tbody>
          </table>
        </div>

        <h2>2. {t('legal.privacy.t2')}</h2>
        <p>{t('legal.privacy.s2Intro')}</p>
        <ul>
          <li><Trans i18nKey="legal.privacy.s2a" components={{ 0: <b />, 1: <b /> }} /></li>
          <li><Trans i18nKey="legal.privacy.s2b" components={{ 0: <b />, 1: <b /> }} /></li>
        </ul>
        <p>{t('legal.privacy.s2Note')}</p>

        <h2>3. {t('legal.privacy.t3')}</h2>
        <p>{t('legal.privacy.s3')}</p>

        <h2>4. {t('legal.privacy.t4')}</h2>
        <p>{t('legal.privacy.s4')}</p>

        <h2>5. {t('legal.privacy.t5')}</h2>
        <p>{t('legal.privacy.s5')}</p>
        <p><Trans i18nKey="legal.privacy.s5b" components={{ 0: <b /> }} /></p>

        <h2>6. {t('legal.privacy.t6')}</h2>
        <p>{t('legal.privacy.s6')}</p>
        <p>{t('legal.privacy.s6b')}</p>

        <h2>7. {t('legal.privacy.t7')}</h2>
        <p>{t('legal.privacy.s7')}</p>

        <div className="legal-contact">
          {t('legal.privacy.contact')}
          <br /><Link className="legal-crosslink" to="/terminos">{t('legal.privacy.seeTerms')}</Link>
        </div>
      </div>
    </div>
  );
}
