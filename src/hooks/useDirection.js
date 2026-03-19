import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const RTL_LANGUAGES = new Set(['he', 'ar', 'ar-LB', 'fa', 'ur']);

export default function useDirection() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const lang = i18n.language || 'en';
    const isRtl = RTL_LANGUAGES.has(lang) || RTL_LANGUAGES.has(lang.split('-')[0]);
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [i18n.language]);
}
