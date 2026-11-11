import { LitigesScreen } from '@/features/litiges/LitigesScreen';
import { requireStaff } from '@/lib/staff';

/** Réservé aux administrateurs : vérifié ici en plus du proxy ; la base refuse aussi (is_admin(), bo_disputes). */
export default async function Page() {
  await requireStaff('/litiges');
  return <LitigesScreen />;
}
