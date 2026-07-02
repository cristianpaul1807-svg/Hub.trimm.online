import React, { createContext, useContext, useState, useEffect } from 'react';
import { es } from '../i18n/es';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { it } from '../i18n/it';
import { pt } from '../i18n/pt';

const translations = { es, en, fr, it, pt };
type Lang = keyof typeof translations;

interface HubLanguageContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: typeof es;
}

const HubLanguageContext = createContext<HubLanguageContextType | undefined>(undefined);

export function HubLanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('hub_lang') as Lang;
    if (saved && translations[saved]) return saved;
    const browser = navigator.language.slice(0, 2) as Lang;
    return translations[browser] ? browser : 'es';
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('hub_lang', l);
  };

  const value = {
    lang,
    setLang,
    t: translations[lang]
  };

  return (
    <HubLanguageContext.Provider value={value}>
      {children}
    </HubLanguageContext.Provider>
  );
}

export const useHubLang = () => {
  const context = useContext(HubLanguageContext);
  if (!context) throw new Error('useHubLang must be used within HubLanguageProvider');
  return context;
};
