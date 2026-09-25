import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import './LegalPage.css';
import { usePageBodyClass } from '../hooks/usePageBodyClass';
import { useTheme } from '../hooks/useTheme';
import LegalBackButton from '../components/LegalBackButton';

export default function TerminosPage() {
  const { t } = useTranslation();
  useTheme();
  usePageBodyClass('page-legal');
  return (
    <div className="legal-wrap">
      <LegalBackButton />
      <div className="legal-card">
        <h1>{t('legal.terms.title')}</h1>
        <p className="legal-updated">{t('legal.updated')}</p>

        <Trans
          i18nKey="legal.terms.intro"
          components={{ 0: <b />, 1: <b />, 2: <b />, 3: <b /> }}
        />

        <div className="legal-toc">
          <p>{t('legal.terms.tocTitle')}</p>
          <ol>
            <li><a href="#s1">{t('legal.terms.t1')}</a></li>
            <li><a href="#s2">{t('legal.terms.t2')}</a></li>
            <li><a href="#s3">{t('legal.terms.t3')}</a></li>
            <li><a href="#s4">{t('legal.terms.t4')}</a></li>
            <li><a href="#s5">{t('legal.terms.t5')}</a></li>
            <li><a href="#s6">{t('legal.terms.t6')}</a></li>
            <li><a href="#s7">{t('legal.terms.t7')}</a></li>
            <li><a href="#s8">{t('legal.terms.t8')}</a></li>
            <li><a href="#s9">{t('legal.terms.t9')}</a></li>
            <li><a href="#s10">{t('legal.terms.t10')}</a></li>
          </ol>
        </div>

        <h2 id="s1">1. {t('legal.terms.t1')}</h2>
        <p>{t('legal.terms.s1')}</p>

        <h2 id="s2">2. {t('legal.terms.t2')}</h2>
        <ul>
          <li>{t('legal.terms.s2a')}</li>
          <li>{t('legal.terms.s2b')}</li>
          <li>{t('legal.terms.s2c')}</li>
        </ul>

        <h2 id="s3">3. {t('legal.terms.t3')}</h2>
        <p>{t('legal.terms.s3')}</p>

        <h2 id="s4">4. {t('legal.terms.t4')}</h2>
        <p>{t('legal.terms.s4')}</p>

        <h2 id="s5">5. {t('legal.terms.t5')}</h2>
        <Trans
          i18nKey="legal.terms.s5"
          components={{ 0: <Link className="legal-crosslink" to="/privacidad" /> }}
        />

        <h2 id="s6">6. {t('legal.terms.t6')}</h2>
        <div className="legal-summary"><b>{t('legal.summaryLabel')}</b> {t('legal.terms.s6Summary')}</div>
        <p>{t('legal.terms.s6')}</p>

        <h2 id="s7">7. {t('legal.terms.t7')}</h2>
        <div className="legal-summary"><b>{t('legal.summaryLabel')}</b> {t('legal.terms.s7Summary')}</div>
        <p>{t('legal.terms.s7a')}</p>
        <p>{t('legal.terms.s7b')}</p>

        <h2 id="s8">8. {t('legal.terms.t8')}</h2>
        <div className="legal-summary"><b>{t('legal.summaryLabel')}</b> {t('legal.terms.s8Summary')}</div>
        <p>{t('legal.terms.s8')}</p>

        <h2 id="s9">9. {t('legal.terms.t9')}</h2>
        <p>{t('legal.terms.s9')}</p>

        <h2 id="s10">10. {t('legal.terms.t10')}</h2>
        <p>{t('legal.terms.s10')}</p>

        <div className="legal-contact">
          {t('legal.terms.contact')}
          <br /><Link className="legal-crosslink" to="/privacidad">{t('legal.terms.seePrivacy')}</Link>
        </div>
      </div>
    </div>
  );
}
