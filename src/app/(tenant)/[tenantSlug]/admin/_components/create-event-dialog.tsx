'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import {
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SelectItem,
} from '@heroui/react'
import { parseDate } from '@internationalized/date'
import { Button } from '@/components/ui/button'
import { DatePicker, Input, Select } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { adminEventPath } from '@/lib/events/paths'
import { createEvent } from '@/lib/actions/create-event'
import { COPY_OPTIONS, type CopyOption } from '@/lib/events/copy-options'
import { changeStageDate, datedStages, nextEditionName, placeStages } from '@/lib/events/copy-dates'

export interface CopySource {
  id: string
  name: string
  status: string
  stages: { id: string; name: string; start_time: string | null }[]
}

const BLANK = 'blank'

// What each option needs ticked first. The RPC refuses the same combinations.
const REQUIRES: Partial<Record<CopyOption, CopyOption>> = {
  distances: 'stages',
  work_areas: 'stages',
  checklists: 'work_areas',
}

const ALL_TICKED = Object.fromEntries(COPY_OPTIONS.map((o) => [o, true])) as Record<
  CopyOption,
  boolean
>

// N23 / TEN-01: "Create event". A yearly race is mostly last year's setup
// with new dates, so the dialog starts from the most recent event with
// everything ticked and the stages moved a year on; a blank event is one
// choice away.
export function CreateEventDialog({
  tenantSlug,
  sources,
  capMessage,
}: {
  tenantSlug: string
  // Newest first, as TEN-01 lists them.
  sources: CopySource[]
  // Set when every slot is taken: the button is disabled and says why.
  capMessage?: string
}) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [sourceId, setSourceId] = useState(BLANK)
  const [copy, setCopy] = useState(ALL_TICKED)
  const [dates, setDates] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())

  const source = sources.find((s) => s.id === sourceId)
  const dated = source ? datedStages(source.stages) : []
  const hasUndated = !!source && dated.length < source.stages.length

  function chooseSource(id: string) {
    const next = sources.find((s) => s.id === id)
    setSourceId(next ? id : BLANK)
    setCopy(ALL_TICKED)
    setDates(next ? placeStages(next.stages) : {})
    setTouched(new Set())
    // Only replace a name the admin has not typed themselves.
    setName((current) =>
      current === '' || sources.some((s) => nextEditionName(s.name) === current)
        ? next
          ? nextEditionName(next.name)
          : ''
        : current
    )
  }

  function openDialog() {
    setName('')
    setSourceId(BLANK)
    if (sources[0]) chooseSource(sources[0].id)
    setOpen(true)
  }

  function toggle(option: CopyOption, on: boolean) {
    setCopy((prev) => {
      const next = { ...prev, [option]: on }
      // Unticking something unticks what depends on it.
      if (!on) {
        for (const [dependent, needs] of Object.entries(REQUIRES)) {
          if (needs === option) next[dependent as CopyOption] = false
        }
        if (option === 'stages') next.checklists = false
      }
      return next
    })
  }

  function changeDate(stageId: string, date: string) {
    if (!source) return
    setDates((prev) => changeStageDate(source.stages, prev, touched, stageId, date))
    setTouched((prev) => new Set(prev).add(stageId))
  }

  const needsDates = !!source && copy.stages && dated.length > 0
  // A warning, not a block: two events may share a name for good reason,
  // but most often it is a slip.
  const nameTaken = sources.some(
    (s) => s.name.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== ''
  )
  const canSubmit =
    name.trim() !== '' && (!needsDates || dated.every((s) => dates[s.id])) && !isPending

  function submit() {
    if (!canSubmit) return
    startTransition(async () => {
      const result = await createEvent({
        tenantSlug,
        name: name.trim(),
        sourceEventId: source?.id ?? null,
        copy: source ? copy : {},
        stageDates: needsDates ? dates : {},
      })
      if ('error' in result && result.error) {
        toastError(result.error)
        return
      }
      setOpen(false)
      // Straight into the new event's configuration: it is a draft that
      // still needs its details checked before it is published.
      router.push(adminEventPath(tenantSlug, (result as { eventId: string }).eventId, 'event'))
    })
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1.5">
        <Button
          color="primary"
          onPress={openDialog}
          isDisabled={!!capMessage}
          startContent={<Plus className="size-4" strokeWidth={2} aria-hidden />}
        >
          {t('events.createEvent.create')}
        </Button>
        {capMessage && <p className="max-w-xs text-right text-xs text-ink-label">{capMessage}</p>}
      </div>

      <Modal
        isOpen={open}
        onOpenChange={(isOpen) => !isOpen && !isPending && setOpen(false)}
        size="lg"
        scrollBehavior="inside"
        classNames={{
          base: 'bg-white rounded-card shadow-modal',
          backdrop: 'bg-ink/45',
          header: 'px-6 pb-2 pt-6 font-display text-xl font-extrabold tracking-tight text-ink',
          body: 'px-6',
          footer: 'gap-3 px-6 pb-6 pt-4',
          closeButton: 'right-4 top-4 text-ink-label hover:bg-status-neutral-bg',
        }}
      >
        <ModalContent>
          <ModalHeader>{t('events.createEvent.title')}</ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label={t('events.createEvent.name')}
              value={name}
              onValueChange={setName}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              isRequired
              autoFocus
              description={
                nameTaken ? (
                  <span className="text-status-pending-text">
                    {t('events.createEvent.nameTaken')}
                  </span>
                ) : undefined
              }
            />

            {sources.length > 0 && (
              <Select
                label={t('events.createEvent.source')}
                selectedKeys={[sourceId]}
                disallowEmptySelection
                onSelectionChange={(keys) => chooseSource(Array.from(keys)[0] as string)}
              >
                {[
                  <SelectItem key={BLANK}>{t('events.createEvent.sourceBlank')}</SelectItem>,
                  ...sources.map((s) => {
                    const label =
                      s.status === 'archived'
                        ? t('events.createEvent.sourceArchived', { name: s.name })
                        : s.name
                    return (
                      <SelectItem key={s.id} textValue={label}>
                        {label}
                      </SelectItem>
                    )
                  }),
                ]}
              </Select>
            )}

            {source && (
              <div className="mt-1 border-t border-edge-soft pt-4">
                <fieldset>
                  <legend className="section-label mb-3">
                    {t('events.createEvent.copyHeading')}
                  </legend>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                    {COPY_OPTIONS.map((option) => {
                      const needs = REQUIRES[option]
                      const blocked = !!needs && !copy[needs]
                      return (
                        <div key={option} className={option === 'stages' ? 'sm:col-span-2' : ''}>
                          <Checkbox
                            isSelected={copy[option] && !blocked}
                            isDisabled={blocked}
                            onValueChange={(on) => toggle(option, on)}
                            classNames={{ label: 'text-[15px] text-ink-soft' }}
                          >
                            {t(`events.createEvent.copy.${option}`)}
                            {blocked && (
                              <span className="ml-1.5 text-xs text-ink-faint">
                                {t(
                                  needs === 'stages'
                                    ? 'events.createEvent.copyNeedsStages'
                                    : 'events.createEvent.copyNeedsWorkAreas'
                                )}
                              </span>
                            )}
                          </Checkbox>

                          {option === 'stages' && needsDates && (
                            <div className="mb-2 ml-7 mt-3 space-y-3 border-l-2 border-edge-soft pl-4">
                              <p className="text-sm text-ink-label">
                                {t('events.createEvent.stageDatesHint')}
                              </p>
                              {dated.map((stage) => (
                                <DatePicker
                                  key={stage.id}
                                  label={stage.name}
                                  aria-label={t('events.createEvent.stageDate', {
                                    name: stage.name,
                                  })}
                                  value={dates[stage.id] ? parseDate(dates[stage.id]) : null}
                                  onChange={(value) =>
                                    value && changeDate(stage.id, value.toString())
                                  }
                                  isRequired
                                />
                              ))}
                              {hasUndated && (
                                <p className="text-xs text-ink-faint">
                                  {t('events.createEvent.undatedStages')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </fieldset>
              </div>
            )}

            <p className="text-sm text-ink-label">
              {t('events.createEvent.draftNote')}
              {source && copy.officials && <> {t('events.createEvent.officialsNote')}</>}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="bordered"
              className="rounded-control border-edge"
              onPress={() => setOpen(false)}
              isDisabled={isPending}
            >
              {t('events.cancel')}
            </Button>
            <Button color="primary" isDisabled={!canSubmit} isLoading={isPending} onPress={submit}>
              {t('events.createEvent.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
