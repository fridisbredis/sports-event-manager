import { Hourglass } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'

// PB3: a closed event (draft, or a tier without the participant side) keeps
// the runner's record and account but shows nothing of the event until it
// opens again. Shared by PAR-01, INFO-01 and ANN-02, the screens that close.
//
// The app's one empty state rather than a grey alert card: the alert icon
// read as an error, when nothing is wrong — the event simply is not open yet.
// An hourglass says "later", which is the whole message.
export function NotAvailable({ title, message }: { title: string; message: string }) {
  return <EmptyState Icon={Hourglass} title={title} description={message} />
}
