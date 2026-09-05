import React, { createContext, useContext, useEffect, useState } from 'react';
import { es } from '../i18n/es';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { it } from '../i18n/it';
import { pt } from '../i18n/pt';

const translations = { es, en, fr, it, pt };
type Lang = keyof typeof translations;

/** Para `og:locale`, que no acepta un código de dos letras a secas. */
const OG_LOCALE: Record<Lang, string> = {
  es: 'es_ES', en: 'en_US', fr: 'fr_FR', it: 'it_IT', pt: 'pt_PT',
};

const esIdioma = (v: string | null | undefined): v is Lang =>
  !!v && Object.prototype.hasOwnProperty.call(translations, v);

/**
 * Idioma pedido en el enlace.
 *
 * Trimm manda a la gente al Hub con `?lang=it`: quien está usando Trimm en
 * italiano no debe aterrizar aquí en español. Eso es una elección ya hecha,
 * así que manda sobre lo que hubiera guardado y sobre el idioma del
 * navegador. Un valor que no conocemos se ignora en vez de romper nada.
 */
function idiomaDelEnlace(): Lang | null {
  if (typeof window === 'undefined') return null;
  const pedido = new URLSearchParams(window.location.search)
    .get('lang')?.trim().slice(0, 2).toLowerCase();
  return esIdioma(pedido) ? pedido : null;
}

/**
 * Quita `lang` de la barra de direcciones una vez leído.
 *
 * Si se quedara, cada recarga volvería a imponerlo y el idioma que elija la
 * persona en el Hub no duraría nada. Se borra también cuando el valor no nos
 * sirve: ya lo hemos mirado, y dejarlo puesto solo estorba al compartir el
 * enlace. Se toca solo ese parámetro: `t` y `tc` viajan en las mismas URLs y
 * tienen que sobrevivir.
 */
function olvidarLangDeLaUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('lang')) return;
  url.searchParams.delete('lang');
  window.history.replaceState(
    window.history.state, '',
    url.pathname + (url.search || '') + url.hash,
  );
}

/** Crea la etiqueta si no existe: index.html no las lleva todas. */
function meta(atributo: 'name' | 'property', clave: string, valor: string) {
  let etiqueta = document.head.querySelector<HTMLMetaElement>(
    `meta[${atributo}="${clave}"]`,
  );
  if (!etiqueta) {
    etiqueta = document.createElement('meta');
    etiqueta.setAttribute(atributo, clave);
    document.head.appendChild(etiqueta);
  }
  etiqueta.setAttribute('content', valor);
}

interface HubLanguageContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: typeof es;
}

const HubLanguageContext = createContext<HubLanguageContextType | undefined>(undefined);

export function HubLanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const delEnlace = idiomaDelEnlace();
    if (delEnlace) return delEnlace;
    const saved = localStorage.getItem('hub_lang') as Lang;
    if (esIdioma(saved)) return saved;
    const browser = navigator.language.slice(0, 2).toLowerCase();
    return esIdioma(browser) ? browser : 'es';
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('hub_lang', l);
  };

  // El idioma del enlace se guarda igual que si se hubiera elegido a mano:
  // quien viene de Trimm en italiano sigue en italiano la próxima vez. El
  // detectado por el navegador no se guarda a propósito: es una suposición, y
  // debe seguir al navegador si este cambia.
  useEffect(() => {
    if (idiomaDelEnlace()) localStorage.setItem('hub_lang', lang);
    olvidarLangDeLaUrl();
    // Solo al montar: después manda lo que elija la persona.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La cabecera del documento sigue al idioma. Sin esto el `<html lang>` y la
  // descripción se quedaban en el español de index.html por mucho que la
  // interfaz cambiara, y los lectores de pantalla leían el idioma equivocado.
  useEffect(() => {
    const textos = translations[lang];
    document.documentElement.lang = lang;
    document.title = textos.meta.siteTitle;
    meta('name', 'description', textos.meta.siteDescription);
    meta('property', 'og:locale', OG_LOCALE[lang]);
    meta('property', 'og:title', textos.meta.ogTitle);
    meta('property', 'og:description', textos.meta.ogDescription);
    meta('name', 'twitter:title', textos.meta.ogTitle);
    meta('name', 'twitter:description', textos.meta.ogDescription);
  }, [lang]);

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
