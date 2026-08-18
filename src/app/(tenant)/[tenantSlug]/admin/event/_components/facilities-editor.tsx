import type { KeyboardEvent } from 'react'
import { Chip } from '@heroui/react'
import { Input } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import type { LabelInput } from '../actions'

interface Props {
  facilities: LabelInput[]
  facilityInput: string
  onFacilityInputChange: (value: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onRemoveFacility: (index: number) => void
}

export function FacilitiesEditor({
  facilities,
  facilityInput,
  onFacilityInputChange,
  onKeyDown,
  onRemoveFacility,
}: Props) {
  const { t } = useTranslation('admin')

  return (
    <div>
      <Input
        label={t('eventConfig.facilities')}
        value={facilityInput}
        onValueChange={onFacilityInputChange}
        onKeyDown={onKeyDown}
        placeholder={t('eventConfig.facilitiesPlaceholder')}
      />
      {facilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {facilities.map((f, i) => (
            <Chip key={i} onClose={() => onRemoveFacility(i)} variant="flat">
              {f.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}
