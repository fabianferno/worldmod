export const metadata = { title: "Offline — World Mod" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4">
      <div className="rounded-panel bg-butter px-6 py-8">
        <h1 className="text-[22px] font-semibold text-butter-ink">You are offline</h1>
        <p className="mt-2.5 text-sm leading-relaxed text-butter-ink">
          Episodes you have already recorded are saved on this device and will upload
          by themselves once you are back online. Nothing is lost.
        </p>
      </div>
    </main>
  );
}
