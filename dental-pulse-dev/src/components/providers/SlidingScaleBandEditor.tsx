import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { formatAmount, parseAmount } from '@/lib/utils';
import type { SlidingScaleBand } from '@/hooks/useSlidingScales';

interface SlidingScaleBandEditorProps {
  title: string;
  bands: SlidingScaleBand[];
  setBands: (bands: SlidingScaleBand[]) => void;
  validationErrors: { [key: number]: string };
  setValidationErrors: (errors: { [key: number]: string }) => void;
  newBandId: number | null;
  setNewBandId: (id: number | null) => void;
  onSave: () => void;
  isSaving: boolean;
}

// Reusable band editor for a provider-level sliding scale, matching the
// existing Associate/Lab sliding scale cards' UI and validation exactly —
// written fresh (not extracted from ProviderDetail.tsx) so those two
// already-shipped cards are never touched.
export function SlidingScaleBandEditor({
  title,
  bands,
  setBands,
  validationErrors,
  setValidationErrors,
  newBandId,
  setNewBandId,
  onSave,
  isSaving,
}: SlidingScaleBandEditorProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-foreground">{title}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-sidebar text-white">
                  <th className="text-left p-3 font-semibold text-sm">Band</th>
                  <th className="text-right p-3 font-semibold text-sm">Start</th>
                  <th className="text-right p-3 font-semibold text-sm">End</th>
                  <th className="text-right p-3 font-semibold text-sm">Percentage</th>
                  <th className="text-center p-3 font-semibold text-sm">Action</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((band, idx) => (
                  <tr
                    key={band.id}
                    className={`border-b border-border ${newBandId === band.id ? 'border-2 border-blue-500' : ''}`}
                  >
                    <td className="p-3">
                      <Input
                        value={band.band}
                        placeholder={band.band === '' ? 'Band name' : undefined}
                        onChange={(e) => {
                          const updated = [...bands];
                          updated[idx].band = e.target.value;
                          setBands(updated);
                          if (newBandId === band.id && e.target.value.trim() !== '') setNewBandId(null);
                        }}
                        className="w-full hover:border-sidebar focus-visible:ring-sidebar"
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        type="text"
                        value={band.start > 0 ? formatAmount(band.start) : '0'}
                        readOnly
                        className="w-full text-right bg-gray-100 cursor-not-allowed"
                      />
                    </td>
                    <td className="p-3">
                      <div className="space-y-1">
                        <Input
                          type="text"
                          value={band.end > 0 ? formatAmount(band.end) : ''}
                          onChange={(e) => {
                            const updated = [...bands];
                            const inputValue = e.target.value;
                            const newEndValue = inputValue === '' ? 0 : parseAmount(inputValue);
                            updated[idx].end = newEndValue;
                            if (idx < updated.length - 1) updated[idx + 1].start = newEndValue;
                            setBands(updated);

                            const errors = { ...validationErrors };
                            if (newEndValue <= band.start) errors[band.id] = 'End must be greater than Start';
                            else delete errors[band.id];
                            if (idx < updated.length - 1) {
                              const nextBand = updated[idx + 1];
                              if (nextBand.end <= newEndValue) errors[nextBand.id] = 'End must be greater than Start';
                              else delete errors[nextBand.id];
                            }
                            setValidationErrors(errors);

                            if (newBandId === band.id && inputValue.trim() !== '') setNewBandId(null);
                          }}
                          placeholder="0"
                          className={`w-full text-right hover:border-sidebar focus-visible:ring-sidebar ${validationErrors[band.id] ? 'border-red-500' : ''}`}
                        />
                        {validationErrors[band.id] && <p className="text-xs text-red-500">{validationErrors[band.id]}</p>}
                      </div>
                    </td>
                    <td className="p-3">
                      <Input
                        type="number"
                        value={band.percentage || ''}
                        onChange={(e) => {
                          const updated = [...bands];
                          updated[idx].percentage = e.target.value === '' ? 0 : Number(e.target.value);
                          setBands(updated);
                          if (newBandId === band.id && e.target.value.trim() !== '') setNewBandId(null);
                        }}
                        placeholder="0"
                        className="w-full text-right hover:border-sidebar focus-visible:ring-sidebar"
                      />
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-600"
                          onClick={() => {
                            const newId = Math.max(...bands.map((b) => b.id), 0) + 1;
                            const lastBand = bands[bands.length - 1];
                            const newBand = { id: newId, band: '', start: lastBand.end || 0, end: 0, percentage: 0 };
                            setBands([...bands, newBand]);
                            setNewBandId(newId);
                            const errors = { ...validationErrors };
                            if (newBand.end <= newBand.start) errors[newBand.id] = 'End must be greater than Start';
                            setValidationErrors(errors);
                          }}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                        {bands.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600"
                            onClick={() => {
                              setBands(bands.filter((_, i) => i !== idx));
                              if (newBandId === band.id) setNewBandId(null);
                            }}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-start">
            <Button
              className="bg-sidebar hover:bg-sidebar hover:text-sidebar-foreground text-white"
              onClick={onSave}
              disabled={isSaving || Object.keys(validationErrors).length > 0}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
