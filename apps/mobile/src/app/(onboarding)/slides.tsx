import { useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/ui/text';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { fontSize, palette, semantic, spacing } from '@diaspay/ui-tokens';
import { useI18n } from '@/i18n';
import type { Key } from '@/i18n';
import { markOnboardingSeen } from '@/state/auth';
import { Button, IllustrationLock, IllustrationProof, IllustrationPurpose, StepDots } from '@/ui';

const SLIDES: Array<{ title: Key; text: Key; Art: ComponentType }> = [
  { title: 'slide1Title', text: 'slide1Text', Art: IllustrationPurpose },
  { title: 'slide2Title', text: 'slide2Text', Art: IllustrationLock },
  { title: 'slide3Title', text: 'slide3Text', Art: IllustrationProof },
];

export default function Slides() {
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<(typeof SLIDES)[number]>>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  async function finish() {
    await markOnboardingSeen();
    router.replace('/login');
  }
  function next() {
    if (last) { void finish(); return; }
    list.current?.scrollToOffset({ offset: (index + 1) * width, animated: true });
    setIndex(index + 1);
  }
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.max(0, Math.min(SLIDES.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))));
  };

  return (
    <SafeAreaView style={st.screen}>
      <View style={st.top}>
        <Button tone="text" label={t('skip')} onPress={() => void finish()} />
      </View>
      <FlatList
        ref={list}
        data={SLIDES}
        keyExtractor={(s) => s.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item: { title, text, Art } }) => (
          <View style={[st.page, { width }]}>
            <Art />
            <Text style={st.title} accessibilityRole="header">{t(title)}</Text>
            <Text style={st.text}>{t(text)}</Text>
          </View>
        )}
      />
      <View style={st.bottom}>
        <StepDots count={SLIDES.length} index={index} accessibilityLabel={t('pageOf', { n: index + 1, total: SLIDES.length })} />
        <Button label={last ? t('start') : t('next')} onPress={next} />
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: semantic.background },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.sm },
  page: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxl + 4, gap: spacing.lg },
  title: { fontSize: 24, fontWeight: '700', color: palette.ink, textAlign: 'center', marginTop: spacing.lg },
  text: { fontSize: fontSize.body + 1, lineHeight: 23, color: palette.muted, textAlign: 'center' },
  bottom: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.xl },
});
