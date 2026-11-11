import { redirect } from 'next/navigation';
import { HOME } from '@/lib/access';

export default function Home() { redirect(HOME); }
