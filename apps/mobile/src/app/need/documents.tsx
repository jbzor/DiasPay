import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newId } from '@diaspay/api-client';
import { REQUIRED_DOCUMENTS, checkFile, missingRequiredDocuments } from '@diaspay/domain';
import type { DocumentKind, DraftDocument } from '@diaspay/domain';
import { fontSize, palette, radius, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api } from '@/state/api';
import { dispatch, saveNow, useWizard } from '@/state/needWizard';
import { pickFile } from '@/features/need/pickFile';
import type { PickSource, PickedFile } from '@/features/need/pickFile';
import { useNeedText } from '@/features/need/text';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Banner, Button, Icon } from '@/ui';

const SOURCES: PickSource[] = ['camera', 'library', 'document'];

/** G5 — Justificatifs : pièces requises de la verticale, envoi simulé avec progression, reprise et suppression. */
export default function NeedDocuments() {
  const { t, locale, errorText } = useI18n();
  const { docLabel, fileSize } = useNeedText();
  const wiz = useWizard();
  const [sheetFor, setSheetFor] = useState<DocumentKind | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  if (!wiz || !wiz.draft.vertical) return null;
  const draft = wiz.draft;
  const vertical = draft.vertical as NonNullable<typeof draft.vertical>;
  const missing = missingRequiredDocuments(vertical, draft.documents);
  const docFor = (kind: DocumentKind) => [...draft.documents].reverse().find((d) => d.kind === kind);

  async function upload(kind: DocumentKind, file: PickedFile, id = newId('doc')) {
    setError(null);
    try {
      checkFile(file); // contrôle local immédiat (le serveur simulé vérifie aussi)
    } catch (e) {
      setError(errorText(e));
      return;
    }
    // Une seule pièce par type : la nouvelle remplace l’ancienne.
    const old = docFor(kind);
    if (old && old.id !== id) {
      dispatch({ type: 'removeDocument', id: old.id });
      if (old.status === 'UPLOADED') await api.removeDocument(draft.id, old.id).catch(() => undefined);
    }
    const placeholder: DraftDocument = { id, kind, name: file.name, mimeType: file.mimeType ?? '', sizeBytes: file.sizeBytes, uri: file.uri, status: 'UPLOADING' };
    dispatch({ type: 'upsertDocument', doc: placeholder });
    await saveNow(); // le brouillon doit exister côté API avant l’envoi
    try {
      const doc = await api.attachDocument(draft.id, { id, kind, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, uri: file.uri },
        (p) => setProgress((s) => ({ ...s, [id]: p })));
      dispatch({ type: 'upsertDocument', doc });
    } catch (e) {
      dispatch({ type: 'upsertDocument', doc: { ...placeholder, status: 'FAILED' } });
      setError(errorText(e));
    } finally {
      setProgress((s) => { const { [id]: _done, ...rest } = s; return rest; });
    }
  }

  async function choose(kind: DocumentKind, source: PickSource) {
    setSheetFor(null);
    try {
      const r = await pickFile(source);
      if (r.kind === 'denied') { setError(t(source === 'camera' ? 'permissionDenied_camera' : 'permissionDenied_library')); return; }
      if (r.kind === 'file') await upload(kind, r.file);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove(doc: DraftDocument) {
    dispatch({ type: 'removeDocument', id: doc.id });
    if (doc.status === 'UPLOADED') await api.removeDocument(draft.id, doc.id).catch(() => undefined);
  }

  const footer = (
    <>
      {missing.length > 0 ? <Banner text={t('missingDocs', { n: missing.length })} /> : null}
    </>
  );

  return (
    <WizardFrame detail={t('documentsTitle')} extraFooter={footer}>
      <View style={st.summary}>
        <Text style={st.summaryLabel}>{t('needType')}</Text>
        <Text style={st.summaryTitle}>{verticalLabel(vertical, locale)}{draft.purpose ? ` · ${draft.purpose}` : ''}</Text>
      </View>
      <Text style={st.h}>{t('requiredDocs')}</Text>
      <View>
        {REQUIRED_DOCUMENTS[vertical].map(({ kind, required }) => {
          const doc = docFor(kind);
          const pct = doc ? progress[doc.id] : undefined;
          const label = docLabel(kind);
          let sub = required ? t('docRequired') : t('docOptional');
          let subColor: string = palette.muted;
          if (doc?.status === 'UPLOADED') sub = `${doc.name} · ${fileSize(doc.sizeBytes)}`;
          if (doc?.status === 'UPLOADING') sub = t('docUploading', { pct: Math.round((pct ?? 0) * 100) });
          if (doc?.status === 'FAILED') { sub = t('docFailed'); subColor = semantic.error; }
          if (doc?.status === 'MISSING') { sub = t('docMissing'); subColor = semantic.error; }
          return (
            <View key={kind} style={st.row}>
              <Icon name="doc" size={22} color={palette.green} />
              <View style={{ flex: 1 }}>
                <Text style={st.docTitle}>{label}</Text>
                <Text style={[st.docSub, { color: subColor }]} accessibilityLiveRegion="polite">{sub}</Text>
                {doc?.status === 'UPLOADING' ? (
                  <View style={st.bar}><View style={[st.barFill, { width: `${Math.round((pct ?? 0) * 100)}%` }]} /></View>
                ) : null}
              </View>
              {doc?.status === 'UPLOADED' ? (
                <View style={st.actions}>
                  <View style={st.ok} accessibilityLabel={t('verified')}><Icon name="check" size={14} color={palette.green} /></View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${t('remove')} : ${label}`} onPress={() => void remove(doc)} style={st.textBtn}>
                    <Text style={st.removeText}>{t('remove')}</Text>
                  </Pressable>
                </View>
              ) : doc?.status === 'FAILED' && doc.uri ? (
                <View style={st.actions}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${t('retry')} : ${label}`} style={st.smallBtn}
                    onPress={() => void upload(kind, { uri: doc.uri as string, name: doc.name, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes }, doc.id)}>
                    <Text style={st.smallBtnText}>{t('retry')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${t('remove')} : ${label}`} onPress={() => void remove(doc)} style={st.iconBtn}>
                    <Icon name="close" size={18} color={palette.muted} />
                  </Pressable>
                </View>
              ) : doc?.status === 'UPLOADING' ? null : (
                <Pressable accessibilityRole="button" accessibilityLabel={t('addFrom', { doc: label })} style={st.smallBtn} onPress={() => setSheetFor(kind)}>
                  <Text style={st.smallBtnText}>{t('add')}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      <Text style={st.formats}>{t('fileFormats')}</Text>
      {error ? <Banner tone="error" text={error} /> : null}

      <Modal visible={sheetFor !== null} transparent animationType="slide" onRequestClose={() => setSheetFor(null)}>
        <View style={st.backdrop}>
          <SafeAreaView edges={['bottom']} style={st.sheet}>
            <Text style={st.sheetTitle} accessibilityRole="header">{sheetFor ? t('addFrom', { doc: docLabel(sheetFor) }) : ''}</Text>
            {SOURCES.map((src) => (
              <Button key={src} tone="secondary" label={t(`src_${src}`)} onPress={() => sheetFor && void choose(sheetFor, src)} />
            ))}
            <Button tone="text" label={t('cancel')} onPress={() => setSheetFor(null)} />
          </SafeAreaView>
        </View>
      </Modal>
    </WizardFrame>
  );
}

const st = StyleSheet.create({
  summary: { borderTopWidth: 1, borderTopColor: palette.line, paddingTop: spacing.md },
  summaryLabel: { fontSize: fontSize.caption, color: palette.muted },
  summaryTitle: { fontSize: fontSize.body, fontWeight: '700', color: palette.ink },
  h: { fontSize: fontSize.body + 1, fontWeight: '700', color: palette.ink, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: palette.line, minHeight: 64 },
  docTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  docSub: { fontSize: fontSize.caption, marginTop: 2 },
  bar: { height: 4, borderRadius: 2, backgroundColor: palette.line, marginTop: 6, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: palette.green },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ok: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.greenTint, alignItems: 'center', justifyContent: 'center' },
  textBtn: { minHeight: touchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
  removeText: { fontSize: fontSize.small, fontWeight: '700', color: palette.red },
  smallBtn: { minHeight: touchTarget, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: palette.green, justifyContent: 'center' },
  smallBtnText: { fontSize: fontSize.small, fontWeight: '700', color: palette.green },
  iconBtn: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  formats: { fontSize: fontSize.caption, color: palette.muted },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,35,26,0.4)' },
  sheet: { backgroundColor: semantic.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.sm },
  sheetTitle: { fontSize: fontSize.title, fontWeight: '700', color: palette.ink, marginBottom: spacing.sm },
});
