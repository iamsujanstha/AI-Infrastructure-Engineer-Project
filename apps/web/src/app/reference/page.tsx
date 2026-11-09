import { LocalWorkspace } from '../../components/local-workspace';

export default function ReferencePage() {
  if(process.env.LEGACY_LOCAL_CHAT_ENABLED!=='true')return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-semibold">Legacy development workspace disabled</h1><p className="mt-4 text-sm">Use the signed-in policy workspace. Historical single-user conversations have not been deleted.</p><a className="mt-5 block text-emerald-200" href="/">Open policy workspace</a></main>;
  return <LocalWorkspace />;
}
