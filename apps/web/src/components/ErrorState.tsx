'use client';
import { errorMessage, t } from '@/i18n';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="banner err" role="alert">
      <p>{t('common.error')} {errorMessage(error)}</p>
      <button type="button" className="btn-link" onClick={onRetry}>{t('common.retry')}</button>
    </div>
  );
}

export function LoadingRows() {
  return <div aria-busy="true" aria-label={t('common.loading')}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>;
}
