import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, Loader2, Save, RotateCcw } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrganization } from '@/hooks/useOrganization';
import {
  useAIPricingSettings,
  DEFAULT_AI_PRICING_PROMPT,
  DEFAULT_AI_PRICING_SETTINGS,
} from '@/hooks/useAIPricingSettings';
import { toast } from 'sonner';

const MODEL_OPTIONS = [
  {
    value: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5 (cheapest, fastest)',
  },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (most capable)' },
];

const WEB_SEARCH_VERSION_OPTIONS = [
  {
    value: 'web_search_20250305',
    label: 'web_search_20250305 (broadly supported, recommended for Haiku)',
  },
  {
    value: 'web_search_20260209',
    label: 'web_search_20260209 (with dynamic filtering, Sonnet/Opus only)',
  },
];

// Predefined regenerate-after duration choices, matched to the seconds the
// hook will actually use. "Always regenerate" means 0 → cache disabled.
const TTL_PRESETS = [
  { label: 'Always regenerate (no cache)', value: 0 },
  { label: '5 minutes', value: 5 * 60 },
  { label: '30 minutes', value: 30 * 60 },
  { label: '1 hour', value: 60 * 60 },
  { label: '6 hours', value: 6 * 60 * 60 },
  { label: '12 hours', value: 12 * 60 * 60 },
  { label: '24 hours (default)', value: 24 * 60 * 60 },
  { label: '7 days', value: 7 * 24 * 60 * 60 },
];

export default function AIPricingSettings() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { settings, isLoading, save, isSaving } =
    useAIPricingSettings(organizationId);

  const [systemPrompt, setSystemPrompt] = useState('');
  const [modelName, setModelName] = useState(
    DEFAULT_AI_PRICING_SETTINGS.model_name,
  );
  const [maxTokens, setMaxTokens] = useState(
    DEFAULT_AI_PRICING_SETTINGS.max_tokens,
  );
  const [regenerateAfterSeconds, setRegenerateAfterSeconds] = useState(
    DEFAULT_AI_PRICING_SETTINGS.regenerate_after_seconds,
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    DEFAULT_AI_PRICING_SETTINGS.web_search_enabled,
  );
  const [webSearchToolVersion, setWebSearchToolVersion] = useState(
    DEFAULT_AI_PRICING_SETTINGS.web_search_tool_version,
  );

  // Sync state in once settings load
  useEffect(() => {
    if (!settings) return;
    setSystemPrompt(settings.system_prompt);
    setModelName(settings.model_name);
    setMaxTokens(settings.max_tokens);
    setRegenerateAfterSeconds(settings.regenerate_after_seconds);
    setWebSearchEnabled(settings.web_search_enabled);
    setWebSearchToolVersion(settings.web_search_tool_version);
  }, [settings?.id]);

  const handleSave = async () => {
    try {
      await save({
        system_prompt: systemPrompt.trim(),
        model_name: modelName,
        max_tokens: maxTokens,
        regenerate_after_seconds: regenerateAfterSeconds,
        web_search_enabled: webSearchEnabled,
        web_search_tool_version: webSearchToolVersion,
      });
      toast.success('AI pricing settings saved');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save settings',
      );
    }
  };

  const handleResetPromptToDefault = () => {
    setSystemPrompt(DEFAULT_AI_PRICING_PROMPT);
    toast.info('Prompt reset to default — click Save to persist');
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh] gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </MainLayout>
    );
  }

  // Show a custom-duration option if the saved value isn't one of the presets.
  const presetMatches = TTL_PRESETS.find(
    (p) => p.value === regenerateAfterSeconds,
  );

  return (
    <MainLayout>
      <Helmet>
        <title>AI Pricing Settings - DentalPulse</title>
      </Helmet>

      <div className="space-y-6 pt-6 max-w-4xl">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/settings')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Suggested Pricing — Settings
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Prompt</CardTitle>
            <CardDescription>
              The system prompt sent to Claude. Edit this to change how the AI
              ranks data sources, what citations it includes, and how it
              formats responses. Returns must remain valid JSON in the
              documented shape.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={20}
              className="font-mono text-xs"
              placeholder="System prompt..."
            />
            <div className="flex justify-between items-center">
              <p className="text-xs text-muted-foreground">
                {systemPrompt.length.toLocaleString()} characters
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetPromptToDefault}
                className="gap-2"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to default
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regeneration cache</CardTitle>
            <CardDescription>
              Controls how often the AI re-runs. Within this window, clicking
              Generate reuses the most recent saved suggestion for the
              treatment instead of calling Claude again. The Refresh button
              always bypasses the cache.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Regenerate after</Label>
              <Select
                value={
                  presetMatches ? String(regenerateAfterSeconds) : 'custom'
                }
                onValueChange={(v) => {
                  if (v !== 'custom') setRegenerateAfterSeconds(Number(v));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select duration" />
                </SelectTrigger>
                <SelectContent>
                  {TTL_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={String(p.value)}>
                      {p.label}
                    </SelectItem>
                  ))}
                  {!presetMatches && (
                    <SelectItem value="custom">
                      Custom: {regenerateAfterSeconds} seconds
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="regen_seconds">Or set in seconds (advanced)</Label>
              <Input
                id="regen_seconds"
                type="number"
                min={0}
                value={regenerateAfterSeconds}
                onChange={(e) =>
                  setRegenerateAfterSeconds(
                    Math.max(0, parseInt(e.target.value || '0', 10) || 0),
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                {regenerateAfterSeconds === 0
                  ? 'Cache disabled — every Generate will hit the AI.'
                  : `Cached for ${regenerateAfterSeconds.toLocaleString()} seconds.`}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model</CardTitle>
            <CardDescription>
              Higher tiers give better web-extraction quality but cost more
              and have stricter rate limits. Haiku is the safe default.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Claude model</Label>
              <Select value={modelName} onValueChange={setModelName}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max_tokens">Max output tokens</Label>
              <Input
                id="max_tokens"
                type="number"
                min={256}
                max={64000}
                value={maxTokens}
                onChange={(e) =>
                  setMaxTokens(parseInt(e.target.value || '0', 10) || 0)
                }
              />
              <p className="text-xs text-muted-foreground">
                4000 is a safe default. Increase if responses get truncated.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Web search</CardTitle>
            <CardDescription>
              When enabled, the AI uses Anthropic&apos;s web_search tool to
              look up real local clinic prices in the selected location&apos;s
              city. Disable to save tokens and rely only on internal data +
              the model&apos;s training knowledge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="web_search_enabled">Enable web search</Label>
                <p className="text-xs text-muted-foreground">
                  Significantly improves accuracy for cities with multiple
                  published-price clinics.
                </p>
              </div>
              <Switch
                id="web_search_enabled"
                checked={webSearchEnabled}
                onCheckedChange={setWebSearchEnabled}
              />
            </div>

            {webSearchEnabled && (
              <div className="space-y-2">
                <Label>Web search tool version</Label>
                <Select
                  value={webSearchToolVersion}
                  onValueChange={setWebSearchToolVersion}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEB_SEARCH_VERSION_OPTIONS.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pb-6">
          <Button
            variant="outline"
            onClick={() => navigate('/settings')}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save settings
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}
