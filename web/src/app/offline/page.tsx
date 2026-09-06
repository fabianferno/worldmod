export const metadata = { title: "Offline — World Mod" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-lg font-semibold">You are offline</h1>
      <p className="mt-2 text-sm text-muted">
        Episodes you have already recorded are saved on this device and will upload
        by themselves once you are back online. Nothing is lost.
      </p>
    </main>
  );
}
