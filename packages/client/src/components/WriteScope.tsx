import { writeScopeText } from '../lib/write-scope';

export default function WriteScope({ paths, t }: { paths?: string[]; t: (zh: string, en: string) => string }) {
  return <section className="sb-write-scope"><h4>{t('允许写入范围', 'Allowed write scope')}</h4><p className="sb-preserve">{writeScopeText(paths, t)}</p></section>;
}
