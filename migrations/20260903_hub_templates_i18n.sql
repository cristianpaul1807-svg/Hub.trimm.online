-- ============================================================
-- TRIMM Hub — Plantillas en el idioma de quien las usa, y botón con destino
--
-- ── El cruce de idiomas ─────────────────────────────────────────────
--
-- La interfaz se traduce y el contenido de las plantillas no, así que un
-- usuario italiano veía «MODELLI DI EMAIL» encima de «Gracias por tu
-- visita». Peor todavía: ese texto no es decoración de la pantalla, es lo
-- que se le manda a sus clientes. Un salón de Milán no puede escribir a su
-- gente en español porque nosotros sembramos el catálogo en español.
--
-- Las del sistema pasan a existir una vez por idioma. La pantalla enseña
-- las del idioma del Hub, y si falta alguna cae al español, que es el
-- catálogo completo.
--
-- ── El destino del botón ────────────────────────────────────────────
--
-- Hasta ahora el botón llevaba siempre a la reserva de la sucursal. Está
-- bien por defecto, pero no siempre: una campaña puede querer llevar a una
-- página concreta, a un formulario o a otro sistema de prenotación. Ahora
-- se puede poner una URL propia; vacío sigue significando «a reservar».
-- ============================================================

-- ── 1. Idioma ───────────────────────────────────────────────────────
ALTER TABLE public.hub_email_templates
  ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'es'
    CHECK (lang IN ('es', 'en', 'fr', 'it', 'pt'));

COMMENT ON COLUMN public.hub_email_templates.lang IS
  'Idioma del CONTENIDO, no de la interfaz. Lo que se manda al cliente.';

-- El código deja de ser único por dueño y pasa a serlo por dueño e idioma:
-- 'descuento' existe cinco veces, una por lengua.
DROP INDEX IF EXISTS idx_hub_templates_sistema;
DROP INDEX IF EXISTS idx_hub_templates_propias;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_templates_sistema
  ON public.hub_email_templates(code, lang) WHERE hub_owner_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_templates_propias
  ON public.hub_email_templates(hub_owner_id, code) WHERE hub_owner_id IS NOT NULL;

-- ── 2. Destino del botón ────────────────────────────────────────────
ALTER TABLE public.hub_email_templates
  ADD COLUMN IF NOT EXISTS cta_url TEXT;

COMMENT ON COLUMN public.hub_email_templates.cta_url IS
  'A dónde lleva el botón. Vacío = a la reserva de la sucursal, que además '
  'es la única que atribuye porque lleva el token de la campaña.';

-- ── 3. El catálogo, en cinco idiomas ────────────────────────────────
-- Traducciones, no calcos: «Te echamos de menos» en inglés no es «We miss
-- you» a secas, y el tuteo español no existe igual en portugués. El texto
-- va a los clientes de un negocio, así que tiene que sonar a que lo
-- escribió el negocio.

-- INGLÉS
INSERT INTO public.hub_email_templates
  (hub_owner_id, code, lang, name, description, layout, subject, preheader,
   headline, body, cta_label, accent_color, is_system)
VALUES
  (NULL, 'descuento', 'en', 'Discount', 'A concrete offer with the percentage front and centre.',
   'offer', '{{descuento}}% off for you at {{negocio}}',
   'Your discount is waiting. Booking takes under a minute.', '{{descuento}}%',
   E'Hi {{cliente}},\n\nWe have set aside {{descuento}}% off your next visit to {{negocio}}.\n\nIt applies automatically when you book from this email.',
   'Book with my discount', '#1d4ed8', true),

  (NULL, 'recuperacion', 'en', 'We miss you', 'For those who have not been around in a while.',
   'hero', '{{negocio}} misses you', 'It has been a while. Your spot is still here.',
   'It has been a while',
   E'Hi {{cliente}},\n\nWe noticed it has been a while since you last came to {{negocio}}.\n\nYour spot is still waiting, and booking takes less than a minute.',
   'Book my appointment', '#1d4ed8', true),

  (NULL, 'fidelidad', 'en', 'Loyalty card', 'Introduces the points programme.',
   'card', 'Your loyalty card at {{negocio}}', 'Every visit counts. Joining is free.',
   'Loyalty programme',
   E'Hi {{cliente}},\n\nAt {{negocio}} every visit earns points, and every so many points you get a reward.\n\nJoining is free and you only do it once.',
   'Activate my card', '#059669', true),

  (NULL, 'novedad', 'en', 'New service', 'To announce something you did not offer before.',
   'hero', 'Something new at {{negocio}}', 'We have something new to show you.',
   'Something new at {{negocio}}',
   E'Hi {{cliente}},\n\nWe have added a new service and wanted you to be among the first to know.\n\nTell us what you think next time you come in.',
   'See availability', '#7c3aed', true),

  (NULL, 'huecos', 'en', 'Openings this week', 'To fill a quiet week. Pairs well with the occupancy figure in Analysis.',
   'plain', 'Does this week work for you at {{negocio}}?', 'We have some slots free these days.',
   NULL,
   E'Hi {{cliente}},\n\nWe have a few slots free at {{negocio}} this week.\n\nIf you fancy dropping by, pick whichever suits you best.',
   'See free slots', '#1d4ed8', true),

  (NULL, 'gracias', 'en', 'Thanks for your visit', 'A short message after coming in.',
   'plain', 'Thanks for coming to {{negocio}}', 'Lovely to see you. Your next appointment is here whenever you want it.',
   NULL,
   E'Hi {{cliente}},\n\nThank you for trusting {{negocio}}. It was a pleasure to have you.\n\nWhenever you want to come back, you know where we are.',
   'Book again', '#0f766e', true),

-- FRANCÉS
  (NULL, 'descuento', 'fr', 'Réduction', 'Une offre claire avec le pourcentage bien visible.',
   'offer', '{{descuento}}% de réduction pour vous chez {{negocio}}',
   'Votre réduction vous attend. Réserver prend moins d''une minute.', '{{descuento}}%',
   E'Bonjour {{cliente}},\n\nNous vous avons réservé {{descuento}}% de réduction pour votre prochaine visite chez {{negocio}}.\n\nElle s''applique automatiquement en réservant depuis cet e-mail.',
   'Réserver avec ma réduction', '#1d4ed8', true),

  (NULL, 'recuperacion', 'fr', 'Vous nous manquez', 'Pour ceux qui ne sont pas passés depuis longtemps.',
   'hero', 'Vous manquez à {{negocio}}', 'Cela fait un moment. Votre place vous attend toujours.',
   'Cela fait un moment',
   E'Bonjour {{cliente}},\n\nNous avons remarqué que vous n''êtes pas passé chez {{negocio}} depuis un certain temps.\n\nVotre place vous attend toujours, et réserver prend moins d''une minute.',
   'Réserver mon rendez-vous', '#1d4ed8', true),

  (NULL, 'fidelidad', 'fr', 'Carte de fidélité', 'Présente le programme de points.',
   'card', 'Votre carte de fidélité chez {{negocio}}', 'Chaque visite compte. L''activer est gratuit.',
   'Programme de fidélité',
   E'Bonjour {{cliente}},\n\nChez {{negocio}}, chaque visite vous rapporte des points, et tous les quelques points vous recevez une récompense.\n\nActiver votre carte est gratuit et ne se fait qu''une fois.',
   'Activer ma carte', '#059669', true),

  (NULL, 'novedad', 'fr', 'Nouveau service', 'Pour annoncer quelque chose que vous ne proposiez pas avant.',
   'hero', 'Du nouveau chez {{negocio}}', 'Nous avons quelque chose de nouveau à vous montrer.',
   'Du nouveau chez {{negocio}}',
   E'Bonjour {{cliente}},\n\nNous avons ajouté un nouveau service et voulions que vous soyez parmi les premiers informés.\n\nDites-nous ce que vous en pensez lors de votre prochaine visite.',
   'Voir les disponibilités', '#7c3aed', true),

  (NULL, 'huecos', 'fr', 'Créneaux cette semaine', 'Pour remplir une semaine creuse. Va bien avec le taux d''occupation dans Analyse.',
   'plain', 'Cette semaine vous conviendrait chez {{negocio}} ?', 'Il nous reste des créneaux libres ces jours-ci.',
   NULL,
   E'Bonjour {{cliente}},\n\nIl nous reste quelques créneaux libres chez {{negocio}} cette semaine.\n\nSi cela vous tente, prenez celui qui vous arrange le mieux.',
   'Voir les créneaux libres', '#1d4ed8', true),

  (NULL, 'gracias', 'fr', 'Merci de votre visite', 'Un message court après le passage.',
   'plain', 'Merci d''être passé chez {{negocio}}', 'Un plaisir de vous voir. Votre prochain rendez-vous vous attend.',
   NULL,
   E'Bonjour {{cliente}},\n\nMerci de votre confiance en {{negocio}}. Ce fut un plaisir de vous recevoir.\n\nQuand vous voudrez revenir, vous savez où nous trouver.',
   'Réserver à nouveau', '#0f766e', true),

-- ITALIANO
  (NULL, 'descuento', 'it', 'Sconto', 'Un''offerta concreta con la percentuale ben visibile.',
   'offer', '{{descuento}}% di sconto per te da {{negocio}}',
   'Il tuo sconto ti aspetta. Prenotare richiede meno di un minuto.', '{{descuento}}%',
   E'Ciao {{cliente}},\n\nAbbiamo messo da parte per te uno sconto del {{descuento}}% sulla tua prossima visita da {{negocio}}.\n\nSi applica automaticamente prenotando da questa email.',
   'Prenota con lo sconto', '#1d4ed8', true),

  (NULL, 'recuperacion', 'it', 'Ci manchi', 'Per chi non si fa vedere da un po''.',
   'hero', '{{negocio}} sente la tua mancanza', 'È passato un po'' di tempo. Il tuo posto è ancora qui.',
   'È passato un po'' di tempo',
   E'Ciao {{cliente}},\n\nAbbiamo notato che è passato un po'' di tempo dall''ultima volta da {{negocio}}.\n\nIl tuo posto ti aspetta ancora, e prenotare richiede meno di un minuto.',
   'Prenota il mio appuntamento', '#1d4ed8', true),

  (NULL, 'fidelidad', 'it', 'Carta fedeltà', 'Presenta il programma a punti.',
   'card', 'La tua carta fedeltà da {{negocio}}', 'Ogni visita conta. Attivarla è gratis.',
   'Programma fedeltà',
   E'Ciao {{cliente}},\n\nDa {{negocio}} ogni visita accumula punti, e ogni tot punti ricevi una ricompensa.\n\nAttivare la carta è gratis e si fa una volta sola.',
   'Attiva la mia carta', '#059669', true),

  (NULL, 'novedad', 'it', 'Nuovo servizio', 'Per annunciare qualcosa che prima non offrivi.',
   'hero', 'Novità da {{negocio}}', 'Abbiamo qualcosa di nuovo da mostrarti.',
   'Novità da {{negocio}}',
   E'Ciao {{cliente}},\n\nAbbiamo aggiunto un nuovo servizio e volevamo che tu fossi tra i primi a saperlo.\n\nDicci cosa ne pensi la prossima volta che vieni.',
   'Vedi disponibilità', '#7c3aed', true),

  (NULL, 'huecos', 'it', 'Posti liberi questa settimana', 'Per riempire una settimana fiacca. Va bene con l''occupazione in Analisi.',
   'plain', 'Ti va bene questa settimana da {{negocio}}?', 'Ci sono rimasti alcuni posti liberi in questi giorni.',
   NULL,
   E'Ciao {{cliente}},\n\nQuesta settimana ci sono rimasti alcuni posti liberi da {{negocio}}.\n\nSe ti va di passare, scegli quello che ti viene meglio.',
   'Vedi i posti liberi', '#1d4ed8', true),

  (NULL, 'gracias', 'it', 'Grazie della visita', 'Un messaggio breve dopo essere passato.',
   'plain', 'Grazie per essere passato da {{negocio}}', 'È stato un piacere. Il prossimo appuntamento quando vuoi.',
   NULL,
   E'Ciao {{cliente}},\n\nGrazie per aver scelto {{negocio}}. È stato un piacere averti con noi.\n\nQuando vorrai tornare, sai dove siamo.',
   'Prenota di nuovo', '#0f766e', true),

-- PORTUGUÉS
  (NULL, 'descuento', 'pt', 'Desconto', 'Uma oferta concreta com a percentagem bem visível.',
   'offer', '{{descuento}}% de desconto para ti em {{negocio}}',
   'O teu desconto está à espera. Reservar leva menos de um minuto.', '{{descuento}}%',
   E'Olá {{cliente}},\n\nGuardámos um desconto de {{descuento}}% em teu nome para a tua próxima visita a {{negocio}}.\n\nAplica-se automaticamente ao reservares a partir deste email.',
   'Reservar com desconto', '#1d4ed8', true),

  (NULL, 'recuperacion', 'pt', 'Temos saudades tuas', 'Para quem já não aparece há algum tempo.',
   'hero', '{{negocio}} tem saudades tuas', 'Já lá vai algum tempo. O teu lugar continua aqui.',
   'Já lá vai algum tempo',
   E'Olá {{cliente}},\n\nRepámos que já há algum tempo que não passas por {{negocio}}.\n\nO teu lugar continua à tua espera, e reservar leva menos de um minuto.',
   'Reservar a minha marcação', '#1d4ed8', true),

  (NULL, 'fidelidad', 'pt', 'Cartão de fidelidade', 'Apresenta o programa de pontos.',
   'card', 'O teu cartão de fidelidade em {{negocio}}', 'Cada visita conta. Activá-lo é grátis.',
   'Programa de fidelidade',
   E'Olá {{cliente}},\n\nEm {{negocio}} cada visita soma pontos, e a cada certo número de pontos recebes uma recompensa.\n\nActivar o teu cartão é grátis e só se faz uma vez.',
   'Activar o meu cartão', '#059669', true),

  (NULL, 'novedad', 'pt', 'Serviço novo', 'Para anunciar algo que antes não oferecias.',
   'hero', 'Novidade em {{negocio}}', 'Temos algo novo para te mostrar.',
   'Algo novo em {{negocio}}',
   E'Olá {{cliente}},\n\nAcrescentámos um serviço novo e queríamos que fosses dos primeiros a saber.\n\nDiz-nos o que achas da próxima vez que vieres.',
   'Ver disponibilidade', '#7c3aed', true),

  (NULL, 'huecos', 'pt', 'Vagas esta semana', 'Para encher uma semana fraca. Combina com a ocupação em Análise.',
   'plain', 'Esta semana dá-te jeito em {{negocio}}?', 'Ficaram-nos algumas vagas livres nestes dias.',
   NULL,
   E'Olá {{cliente}},\n\nEsta semana ficaram-nos algumas vagas livres em {{negocio}}.\n\nSe te apetecer passar, escolhe a que melhor te der jeito.',
   'Ver vagas livres', '#1d4ed8', true),

  (NULL, 'gracias', 'pt', 'Obrigado pela visita', 'Uma mensagem breve depois de vires.',
   'plain', 'Obrigado por passares por {{negocio}}', 'Foi um prazer ver-te. A próxima marcação quando quiseres.',
   NULL,
   E'Olá {{cliente}},\n\nObrigado por confiares em {{negocio}}. Foi um prazer atender-te.\n\nQuando quiseres repetir, já sabes onde estamos.',
   'Reservar de novo', '#0f766e', true)
ON CONFLICT DO NOTHING;

-- ── 4. Servir el catálogo del idioma pedido ─────────────────────────
-- Con respaldo al español, que es el catálogo completo. Se hace en la base
-- de datos y no filtrando en el navegador porque el respaldo tiene que ser
-- por plantilla: si mañana se añade una séptima solo en español, quien
-- tenga el Hub en italiano debe verla igualmente, en español, y no
-- quedarse sin ella.
CREATE OR REPLACE FUNCTION public.hub_templates_for(p_lang TEXT DEFAULT 'es')
RETURNS SETOF public.hub_email_templates
LANGUAGE sql
STABLE
SECURITY INVOKER          -- respeta la RLS de la tabla, a propósito
SET search_path = public
AS $$
  -- Las propias van todas: las escribió su dueño en el idioma que quiso.
  SELECT * FROM hub_email_templates
   WHERE hub_owner_id = auth.uid() AND active

  UNION ALL

  -- Y de las del sistema, una por código: la del idioma pedido si existe,
  -- si no la española.
  --
  -- El DISTINCT ON va dentro de un subselect porque un ORDER BY suelto
  -- tras un UNION lo toma PostgreSQL como el orden del conjunto entero, y
  -- ahí no valen expresiones.
  SELECT * FROM (
    SELECT DISTINCT ON (code) *
      FROM hub_email_templates
     WHERE hub_owner_id IS NULL AND active
       AND lang IN (COALESCE(NULLIF(p_lang, ''), 'es'), 'es')
     ORDER BY code, (lang = COALESCE(NULLIF(p_lang, ''), 'es')) DESC
  ) del_sistema
$$;

REVOKE ALL ON FUNCTION public.hub_templates_for(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hub_templates_for(TEXT) TO authenticated;

COMMENT ON FUNCTION public.hub_templates_for(TEXT) IS
  'Catálogo en el idioma pedido, con respaldo al español por plantilla.';
