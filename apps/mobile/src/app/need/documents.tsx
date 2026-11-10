import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newId } from '@diaspay/api-client';
import { MAX_FILES_PER_KIND, REQUIRED_DOCUMENTS, checkFile, checkFileCount, missingRequiredDocuments } from '@diaspay/domain';
import type { DocumentKind, DraftDocument } from '@diaspay/domain';
import { fontSize, palette, radius, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';
import { useI18n, verticalLabel } from '@/i18n';
import { api } from '@/state/api';
import { dispatch, saveNow, useWizard } from '@/state/needWizard';
import { filesForKind, occupiedSlots } from '@/features/need/documents';
import { pickFile } from '@/features/need/pickFile';
import type { PickSource, PickedFile } from '@/features/need/pickFile';
import { useNeedText } from '@/features/need/text';
import { WizardFrame } from '@/features/need/WizardFrame';
import { Banner, Button, Icon } from '@/ui';

const SOURCES: PickSource[] = ['camera', 'library', 'document'];

/**
 * G5 — Justificatifs : pièces requises de la verticale ; jusqu’à 3 fichiers par pièce (décision D2) ;
 * envoi simulé avec progression, reprise après échec, retrait d’un fichier précis.
 */
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

  async function upload(kind: DocumentKind, file: PickedFile, id = newId('doc')) {
    setError(null);
    try {
      checkFile(file); // contrôle local immédiat (le serveur simulé vérifie aussi)
      const retry = draft.documents.some((d) => d.id === id);
      if (!retry) checkFileCount(occupiedSlots(draft.documents, kind));
    } catch (e) {
      setError(errorText(e));
      return;
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

  const footer = missing.length > 0 ? <Banner text={t('missingDocs', { n: missing.length })} /> : null;

  return (
    <WizardFrame detail={t('documentsTitle')} extraFooter={footer}>
      <View style={st.summary}>
        <Text style={st.summaryLabel}>{t('needType')}</Text>
        <Text style={st.summaryTitle}>{verticalLabel(vertical, locale)}{draft.purpose ? ` · ${draft.purpose}` : ''}</Text>
      </View>
      <Text style={st.h}>{t('requiredDocs')}</Text>
      <View>
        {REQUIRED_DOCUMENTS[vertical].map(({ kind, required }) => {
          const files = filesForKind(draft.documents, kind);
          const used = occupiedSlots(draft.documents, kind);
          const label = docLabel(kind);
          const provided = files.some((f) => f.status === 'UPLOADED');
          return (
            <View key={kind} style={st.kind}>
              <View style={st.kindHead}>
                <Icon name="doc" size={22} color={palette.green} />
                <View style={{ flex: 1 }}>
                  <Text style={st.docTitle}>{label}</Text>
                  <Text style={st.docSub}>
                    {required ? t('docRequired') : t('docOptional')}
                    {used > 0 ? ` · ${t('filesCount', { n: used, max: MAX_FILES_PER_KIND })}` : ''}
                  </Text>
                </View>
                {provided ? <View style={st.ok} accessibilityLabel={t('verified')}><Icon name="check" size={14} color={palette.green} /></View> : null}
                {used < MAX_FILES_PER_KIND ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('addFrom', { doc: label })} style={st.smallBtn} onPress={() => setSheetFor(kind)}>
                    <Text style={st.smallBtnText}>{t('add')}</Text>
                  </Pressable>
                ) : null}
              </View>
              {files.map((doc) => <FileRow key={doc.id} doc={doc} pct={progress[doc.id]} fileSize={fileSize}
                onRemove={() => void remove(doc)}
                onRetry={doc.uri ? () => void upload(kind, { uri: doc.uri as string, name: doc.name, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes }, doc.id) : undefined} />)}
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

/** Un fichier : miniature (image) ou icône, nom, taille ou état, « Retirer » ou « Réessayer ». */
function FileRow({ doc, pct, fileSize, onRemove, onRetry }: {
  doc: DraftDocument; pct?: number; fileSize: (n: number) => string; onRemove: () => void; onRetry?: () => void;
}) {
  const { t } = useI18n();
  let sub = fileSize(doc.sizeBytes);
  let color: string = palette.muted;
  if (doc.status === 'UPLOADING') sub = t('docUploading', { pct: Math.round((pct ?? 0) * 100) });
  if (doc.status === 'FAILED') { sub = t('docFailed'); color = semantic.error; }
  if (doc.status === 'MISSING') { sub = t('docMissing'); color = semantic.error; }
  const image = doc.mimeType.startsWith('image/') && doc.uri && doc.status !== 'MISSING';
  return (
    <View style={st.file}>
      {image
        ? <Image source={{ uri: doc.uri }} style={st.thumb} accessibilityIgnoresInvertColors />
        : <View style={st.thumbIcon}><Icon name="doc" size={18} color={palette.muted} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={st.fileName} numberOfLines={1}>{doc.name}</Text>
        <Text style={[st.docSub, { color }]} accessibilityLiveRegion="polite">{sub}</Text>
        {doc.status === 'UPLOADING' ? <View style={st.bar}><View style={[st.barFill, { width: `${Math.round((pct ?? 0) * 100)}%` }]} /></View> : null}
      </View>
      {doc.status === 'FAILED' && onRetry ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('retry')} : ${doc.name}`} onPress={onRetry} style={st.textBtn}>
          <Text style={st.retryText}>{t('retry')}</Text>
        </Pressable>
      ) : null}
      {doc.status !== 'UPLOADING' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('removeFile', { name: doc.name })} onPress={onRemove} style={st.textBtn}>
          <Text style={st.removeText}>{t('remove')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  summary: { borderTopWidth: 1, borderTopColor: palette.line, paddingTop: spacing.md },
  summaryLabel: { fontSize: fontSize.caption, color: palette.muted },
  summaryTitle: { fontSize: fontSize.body, fontWeight: '700', color: palette.ink },
  h: { fontSize: fontSize.body + 1, fontWeight: '700', color: palette.ink, marginTop: spacing.sm },
  kind: { borderTopWidth: 1, borderTopColor: palette.line, paddingVertical: spacing.md, gap: spacing.sm },
  kindHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  docTitle: { fontSize: fontSize.body, fontWeight: '600', color: palette.ink },
  docSub: { fontSize: fontSize.caption, color: palette.muted, marginTop: 2 },
  ok: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.greenTint, alignItems: 'center', justifyContent: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: 34 },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: palette.line },
  thumbIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: semantic.surface, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: fontSize.small + 1, fontWeight: '500', color: palette.ink },
  bar: { height: 4, borderRadius: 2, backgroundColor: palette.line, marginTop: 6, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: palette.green },
  textBtn: { minHeight: touchTarget, minWidth: touchTarget, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xs },
  removeText: { fontSize: fontSize.small, fontWeight: '700', color: palette.red },
  retryText: { fontSize: fontSize.small, fontWeight: '700', color: palette.green },
  smallBtn: { minHeight: touchTarget, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: palette.green, justifyContent: 'center' },
  smallBtnText: { fontSize: fontSize.small, fontWeight: '700', color: palette.green },
  formats: { fontSize: fontSize.caption, color: palette.muted },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,35,26,0.4)' },
  sheet: { backgroundColor: semantic.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.sm },
  sheetTitle: { fontSize: fontSize.title, fontWeight: '700', color: palette.ink, marginBottom: spacing.sm },
});
