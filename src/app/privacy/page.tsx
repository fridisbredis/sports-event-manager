export default function PrivacyPage() {
  return (
    <main className="flex min-h-dvh flex-col max-w-sm mx-auto px-6 py-12">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Privacy policy</h1>
      <p className="mb-6 inline-block w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
        DRAFT — awaiting final content
      </p>
      <div className="space-y-4 text-sm text-gray-600 leading-relaxed">
        <p>
          This is a placeholder privacy policy. The final version, defining exactly what personal
          data we collect, why, and for how long, has not yet been provided by the event organizer.
        </p>
        <p>
          In short: we store your name and phone number to manage event scheduling and to send you
          SMS notifications about your assignments. If you stop logging in, your account is
          automatically removed after a period of inactivity.
        </p>
      </div>
    </main>
  )
}
