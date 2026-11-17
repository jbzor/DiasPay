// Lot X (X1.4) : gabarits des notifications externes (SMS, e-mail, WhatsApp).
// Exigence 5.1 du cahier : le TrustLink n’est JAMAIS transmis par ces canaux. Ils n’envoient qu’une invitation à ouvrir
// l’application : texte fixe, sans lien, sans adresse, sans montant, sans nom, sans référence. Aucun paramètre n’est
// interpolé (pas d’accolade) : un gabarit ne peut donc pas transporter de donnée. Test d’architecture :
// packages/domain/test/notificationTemplates.test.ts.

export type ExternalChannel = 'SMS' | 'EMAIL' | 'WHATSAPP';
export const EXTERNAL_CHANNELS: readonly ExternalChannel[] = ['SMS', 'EMAIL', 'WHATSAPP'];

/** Familles d’événements annoncés à l’extérieur. Le détail ne se lit que dans l’application, après connexion. */
export type ExternalEvent = 'PAYMENT_REQUEST_RECEIVED' | 'REQUEST_UPDATED' | 'PAYMENT_UPDATED';
export const EXTERNAL_EVENTS: readonly ExternalEvent[] = ['PAYMENT_REQUEST_RECEIVED', 'REQUEST_UPDATED', 'PAYMENT_UPDATED'];

export type ExternalLocale = 'fr' | 'en';
export interface ExternalTemplate { subject?: string; body: string }

const BODY: Record<ExternalEvent, Record<ExternalLocale, string>> = {
  PAYMENT_REQUEST_RECEIVED: {
    fr: 'Vous avez une nouvelle demande de paiement DiasPay. Ouvrez l’application DiasPay pour la consulter.',
    en: 'You have a new DiasPay payment request. Open the DiasPay app to view it.',
  },
  REQUEST_UPDATED: {
    fr: 'Une demande DiasPay a été mise à jour. Ouvrez l’application DiasPay pour la consulter.',
    en: 'A DiasPay request has been updated. Open the DiasPay app to view it.',
  },
  PAYMENT_UPDATED: {
    fr: 'Un paiement DiasPay a changé d’état. Ouvrez l’application DiasPay pour le consulter.',
    en: 'A DiasPay payment has changed status. Open the DiasPay app to view it.',
  },
};

const SUBJECT: Record<ExternalEvent, Record<ExternalLocale, string>> = {
  PAYMENT_REQUEST_RECEIVED: { fr: 'Nouvelle demande de paiement DiasPay', en: 'New DiasPay payment request' },
  REQUEST_UPDATED: { fr: 'Mise à jour d’une demande DiasPay', en: 'DiasPay request update' },
  PAYMENT_UPDATED: { fr: 'Mise à jour d’un paiement DiasPay', en: 'DiasPay payment update' },
};

/** Rappel contre l’hameçonnage (e-mail et WhatsApp ; le SMS reste court). */
const NEVER_LINKS: Record<ExternalLocale, string> = {
  fr: 'DiasPay ne vous envoie jamais de lien de paiement par SMS, e-mail ou WhatsApp.',
  en: 'DiasPay never sends payment links by text message, email or WhatsApp.',
};

function build(channel: ExternalChannel): Record<ExternalEvent, Record<ExternalLocale, ExternalTemplate>> {
  const out = {} as Record<ExternalEvent, Record<ExternalLocale, ExternalTemplate>>;
  for (const event of EXTERNAL_EVENTS) {
    const per = {} as Record<ExternalLocale, ExternalTemplate>;
    for (const locale of ['fr', 'en'] as const) {
      const body = channel === 'SMS' ? BODY[event][locale] : `${BODY[event][locale]} ${NEVER_LINKS[locale]}`;
      per[locale] = channel === 'EMAIL' ? { subject: SUBJECT[event][locale], body } : { body };
    }
    out[event] = per;
  }
  return out;
}

export const externalNotificationTemplates: Readonly<Record<ExternalChannel, Record<ExternalEvent, Record<ExternalLocale, ExternalTemplate>>>> = {
  SMS: build('SMS'),
  EMAIL: build('EMAIL'),
  WHATSAPP: build('WHATSAPP'),
};

/** Famille externe d’un événement de l’application (NotificationEvent.type) ; inconnu → mise à jour générique. */
export function externalEventFor(type: string): ExternalEvent {
  if (type === 'PAYMENT_REQUEST_RECEIVED') return 'PAYMENT_REQUEST_RECEIVED';
  if (['PAYMENT_READY', 'TRANCHE_CONFIRMED', 'TRANCHE_RELEASED', 'DISPUTE_RESOLVED'].includes(type)) return 'PAYMENT_UPDATED';
  return 'REQUEST_UPDATED';
}

/** Texte à envoyer : toujours un gabarit fixe, jamais un contenu fourni par l’appelant. */
export function externalNotification(channel: ExternalChannel, type: string, locale: ExternalLocale): ExternalTemplate {
  return externalNotificationTemplates[channel][externalEventFor(type)][locale];
}
