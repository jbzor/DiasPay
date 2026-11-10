import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { AppNotification } from '@diaspay/api-client';
import { fontSize, palette, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import type { Key } from '@/i18n';
import { api, useTransactions } from '@/state/api';
import { useNotifications } from '@/state/notifications';
import { alertKeys, groupByDay } from '@/features/alerts/alerts';
import { IllustrationBellCheck, Screen } from '@/ui';
import { Text } from '@/ui/text';

/** E1 — Alertes : groupées par jour, non lues marquées d’un point vert ; état vide conçu. */
export default function Alerts() {
  const { t, locale, date, shortDate, dateTime } = useI18n();
  const list = useNotifications();
  const txs = useTransactions();
  const time = (iso: string) => new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const fmt = {
    vertical: (tx: { vertical: Parameters<typeof verticalLabel>[0] }) => verticalLabel(tx.vertical, locale),
    date: shortDate,
    dateTime,
    outcome: (o: 'RELEASED' | 'REFUNDED') => t(`outcome_${o}`),
  };
  const groupLabel = (key: string, day: string) => (key === 'today' ? t('today') : key === 'yesterday' ? t('yesterday') : date(day));

  async function open(n: AppNotification) {
    await api.markNotificationRead(n.id).catch(() => undefined);
    router.push(`/tx/${n.event.txId}`);
  }

  if (list && list.length === 0) {
    return (
      <Screen scroll={false}>
        <Text style={st.title} accessibilityRole="header">{t('alertsTitle')}</Text>
        <View style={st.empty}>
          <IllustrationBellCheck size={96} />
          <Text style={st.emptyTitle}>{t('noAlertsTitle')}</Text>
          <Text style={st.emptyText}>{t('noAlertsText')}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push('/profile/security')} style={st.link}>
            <Text style={st.linkText}>{t('manageNotifications')}</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const hasUnread = (list ?? []).some((n) => !n.readAt);
  return (
    <Screen>
      <View style={st.head}>
        <Text style={st.title} accessibilityRole="header">{t('alertsTitle')}</Text>
        {hasUnread ? (
          <Pressable accessibilityRole="button" onPress={() => void api.markAllNotificationsRead()} style={st.markAll}>
            <Text style={st.markAllText}>{t('markAllRead')}</Text>
          </Pressable>
        ) : null}
      </View>
      {groupByDay(list ?? [], new Date()).map((g) => (
        <View key={g.day}>
          <Text style={st.group} accessibilityRole="header">{groupLabel(g.key, g.day)}</Text>
          {g.items.map((n) => {
            const k = alertKeys(n, txs, fmt);
            const title = t(k.title as Key, k.params);
            // Une date abrégée (« 15 nov. ») en fin de phrase ne double pas le point.
            const body = t(k.body as Key, k.params).replace(/\.\./g, '.');
            const unread = !n.readAt;
            return (
              <Pressable key={n.id} accessibilityRole="button" onPress={() => void open(n)}
                accessibilityLabel={`${unread ? `${t('unread')}, ` : ''}${title}, ${body}, ${time(n.at)}`}
                style={({ pressed }) => [st.row, pressed ? { opacity: 0.7 } : null]}>
                <View style={st.dotCol}>{unread ? <View style={st.dot} /> : null}</View>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={st.titleRow}>
                    <Text style={[st.itemTitle, unread ? st.itemTitleUnread : null]} numberOfLines={1}>{title}</Text>
                    <Text style={st.time}>{time(n.at)}</Text>
                  </View>
                  <Text style={st.body} numberOfLines={2}>{body}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 26, fontWeight: '600', color: palette.ink },
  markAll: { minHeight: touchTarget, justifyContent: 'center' },
  markAllText: { fontSize: fontSize.body, fontWeight: '600', color: palette.green },
  group: { fontSize: fontSize.small, fontWeight: '600', color: palette.muted, paddingTop: spacing.sm, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: palette.line },
  row: { flexDirection: 'row', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.line, minHeight: touchTarget },
  dotCol: { width: 20, paddingTop: 7 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.green },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  itemTitle: { flex: 1, fontSize: fontSize.body + 1, fontWeight: '500', color: palette.ink },
  itemTitleUnread: { fontWeight: '600' },
  time: { fontSize: fontSize.small, color: palette.muted },
  body: { fontSize: fontSize.body - 1, lineHeight: 19, color: palette.muted },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: palette.ink, textAlign: 'center', marginTop: spacing.sm },
  emptyText: { fontSize: fontSize.body, lineHeight: 22, color: semantic.textMuted, textAlign: 'center' },
  link: { minHeight: touchTarget, justifyContent: 'center', marginTop: spacing.sm },
  linkText: { fontSize: fontSize.body, fontWeight: '600', color: palette.green },
});
