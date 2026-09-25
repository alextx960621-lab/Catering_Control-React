import { useTranslation } from 'react-i18next';

export default function MessageAlert({ message }) {
  const { t } = useTranslation();
  if (!message?.text) return null;
  return (
    <div className={`alert alert-${message.error ? 'danger' : 'warning'} mt-3 mb-0`}>
      {message.text}
      {message.showSupport && message.wa && (
        <>
          {' '}
          <a className="alert-link" href={message.wa} target="_blank" rel="noopener">
            {t('portal.contactWhatsapp')}
          </a>
        </>
      )}
    </div>
  );
}
