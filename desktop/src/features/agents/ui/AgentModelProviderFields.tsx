import * as React from "react";
import { AnimatePresence } from "motion/react";

import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";
import type { EnvVarsValue } from "./EnvVarsEditor";
import { PersonaDropdownField } from "./PersonaDropdownField";
import { PersonaModelField } from "./PersonaModelField";
import { PersonaProviderApiKeyField } from "./PersonaProviderApiKeyField";
import {
  AUTO_MODEL_DROPDOWN_VALUE,
  AUTO_PROVIDER_DROPDOWN_VALUE,
  CUSTOM_MODEL_DROPDOWN_VALUE,
  CUSTOM_PROVIDER_DROPDOWN_VALUE,
  getDefaultLlmProviderLabel,
  getModelSelectValue,
  getPersonaModelOptions,
  getPersonaProviderOptions,
  getProviderApiKeyConfig,
  getProviderApiKeyEnvVar,
  getRuntimePersonaModelOptions,
  hasPersonaModelOption,
  PERSONA_FIELD_CONTROL_CLASS,
  PERSONA_FIELD_SHELL_CLASS,
  PERSONA_LABEL_OPTIONAL_CLASS,
  providerRequiresExplicitModel,
  runtimeSupportsLlmProviderSelection,
  shouldClearKnownModelForSelectionScope,
  type PersonaDropdownOption,
} from "./personaDialogPickers";
import {
  MODEL_DISCOVERY_LOADING_VALUE,
  usePersonaModelDiscovery,
} from "./usePersonaModelDiscovery";

const FIELD_TRANSITION = { duration: 0.18, ease: [0.23, 1, 0.32, 1] } as const;

/**
 * LLM provider + model pickers (with live model discovery) and the managed
 * provider API-key field, for a given ACP runtime. Controlled: the parent
 * owns `model`, `provider`, and `envVars`.
 */
export function AgentModelProviderFields({
  disabled,
  envVars,
  model,
  open,
  provider,
  runtimeId,
  selectedRuntime,
  onEnvVarsChange,
  onModelChange,
  onProviderChange,
}: {
  disabled: boolean;
  envVars: EnvVarsValue;
  model: string;
  open: boolean;
  provider: string;
  runtimeId: string;
  selectedRuntime: AcpRuntimeCatalogEntry | undefined;
  onEnvVarsChange: (next: EnvVarsValue) => void;
  onModelChange: (next: string) => void;
  onProviderChange: (next: string) => void;
}) {
  const [isCustomModelEditing, setIsCustomModelEditing] = React.useState(false);
  const [isCustomProviderEditing, setIsCustomProviderEditing] =
    React.useState(false);

  const trimmedRuntime = runtimeId.trim();
  const llmProviderFieldVisible =
    trimmedRuntime.length > 0 &&
    runtimeSupportsLlmProviderSelection(trimmedRuntime);
  const modelFieldVisible = trimmedRuntime.length > 0;
  const providerForModelScope = llmProviderFieldVisible ? provider : "";
  const trimmedProvider = provider.trim();
  const providerApiKeyConfig =
    llmProviderFieldVisible && !isCustomProviderEditing
      ? getProviderApiKeyConfig(trimmedProvider)
      : null;
  const providerApiKeyValue = providerApiKeyConfig
    ? (envVars[providerApiKeyConfig.envVar] ?? "")
    : "";
  const isExplicitModelRequired =
    modelFieldVisible && providerRequiresExplicitModel(providerForModelScope);

  const {
    discoveredModelOptions,
    modelDiscoveryLoading,
    modelDiscoveryStatus,
  } = usePersonaModelDiscovery({
    envVars,
    isCustomProviderEditing,
    modelFieldVisible,
    open,
    provider: providerForModelScope,
    selectedRuntime,
  });

  const staticModelOptions = getPersonaModelOptions(
    trimmedRuntime,
    providerForModelScope,
  );
  const runtimeModelOptions = getRuntimePersonaModelOptions(trimmedRuntime);
  const modelOptions = discoveredModelOptions ?? staticModelOptions;
  const isModelCustom = !hasPersonaModelOption(
    discoveredModelOptions ?? runtimeModelOptions,
    model,
  );
  const modelSelectValue = getModelSelectValue({
    isCustomModelEditing,
    isModelCustom,
    model,
  });
  const showCustomModelInput =
    modelFieldVisible && (isCustomModelEditing || isModelCustom);
  const providerOptions = getPersonaProviderOptions(
    providerForModelScope,
    trimmedRuntime,
  );
  const providerSelectValue = isCustomProviderEditing
    ? CUSTOM_PROVIDER_DROPDOWN_VALUE
    : trimmedProvider || AUTO_PROVIDER_DROPDOWN_VALUE;
  const providerDropdownOptions: PersonaDropdownOption[] = [
    ...providerOptions.map((option) => ({
      // The "Default" option means "no explicit provider" — render it faded
      // in the trigger, like placeholder text.
      isPlaceholder: option.id === "",
      label: option.label,
      value: option.id || AUTO_PROVIDER_DROPDOWN_VALUE,
    })),
    { label: "Custom provider...", value: CUSTOM_PROVIDER_DROPDOWN_VALUE },
  ];
  const modelDropdownOptions: PersonaDropdownOption[] = [
    ...modelOptions.map((option) => ({
      // Same treatment for "Default model" — it's the absence of a choice.
      isPlaceholder: option.id === "",
      label: option.label,
      value: option.id || AUTO_MODEL_DROPDOWN_VALUE,
    })),
    ...(modelDiscoveryLoading && discoveredModelOptions === null
      ? [
          {
            disabled: true,
            label: "Loading models...",
            value: MODEL_DISCOVERY_LOADING_VALUE,
          },
        ]
      : []),
    { label: "Custom model...", value: CUSTOM_MODEL_DROPDOWN_VALUE },
  ];

  React.useEffect(() => {
    if (
      !open ||
      !modelFieldVisible ||
      isCustomModelEditing ||
      !shouldClearKnownModelForSelectionScope({
        model,
        provider: providerForModelScope,
        runtime: trimmedRuntime,
      })
    ) {
      return;
    }

    onModelChange("");
    setIsCustomModelEditing(false);
  }, [
    isCustomModelEditing,
    model,
    modelFieldVisible,
    onModelChange,
    open,
    providerForModelScope,
    trimmedRuntime,
  ]);

  // Reset custom-editing state and clear a provider that the new runtime
  // can't choose whenever the runtime changes underneath us.
  const previousRuntimeRef = React.useRef(trimmedRuntime);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs only on runtime change
  React.useEffect(() => {
    if (previousRuntimeRef.current === trimmedRuntime) {
      return;
    }
    previousRuntimeRef.current = trimmedRuntime;
    if (!llmProviderFieldVisible && trimmedProvider.length > 0) {
      clearManagedProviderApiKeyWhenLeaving(trimmedProvider, "");
      setIsCustomProviderEditing(false);
      onProviderChange("");
    }
    setIsCustomModelEditing(false);
  }, [trimmedRuntime]);

  function updateProviderApiKey(envKey: string, value: string) {
    const current = envVars[envKey] ?? "";
    if (current === value) {
      return;
    }
    const next = { ...envVars };
    if (value.length > 0) {
      next[envKey] = value;
    } else {
      delete next[envKey];
    }
    onEnvVarsChange(next);
  }

  function clearManagedProviderApiKeyWhenLeaving(
    previousProvider: string,
    nextProvider: string,
  ) {
    const previousEnvVar = getProviderApiKeyEnvVar(previousProvider);
    const nextEnvVar = getProviderApiKeyEnvVar(nextProvider);
    if (previousEnvVar && previousEnvVar !== nextEnvVar) {
      if (previousEnvVar in envVars) {
        const next = { ...envVars };
        delete next[previousEnvVar];
        onEnvVarsChange(next);
      }
    }
  }

  function handleProviderDropdownChange(nextValue: string) {
    if (nextValue === CUSTOM_PROVIDER_DROPDOWN_VALUE) {
      clearManagedProviderApiKeyWhenLeaving(provider, "");
      setIsCustomProviderEditing(true);
      onProviderChange("");
      return;
    }

    const nextProvider =
      nextValue === AUTO_PROVIDER_DROPDOWN_VALUE ? "" : nextValue;
    clearManagedProviderApiKeyWhenLeaving(provider, nextProvider);
    setIsCustomProviderEditing(false);
    onProviderChange(nextProvider);
    const requiredEnvVar = getProviderApiKeyEnvVar(nextProvider);
    if (requiredEnvVar && !envVars[requiredEnvVar]?.trim()) {
      onModelChange("");
      setIsCustomModelEditing(false);
      return;
    }
    if (
      !isCustomModelEditing &&
      shouldClearKnownModelForSelectionScope({
        model,
        provider: nextProvider,
        runtime: trimmedRuntime,
      })
    ) {
      onModelChange("");
      setIsCustomModelEditing(false);
    }
  }

  function handleModelDropdownChange(nextValue: string) {
    if (nextValue === CUSTOM_MODEL_DROPDOWN_VALUE) {
      setIsCustomModelEditing(true);
      if (!isModelCustom) {
        onModelChange("");
      }
      return;
    }

    setIsCustomModelEditing(false);
    onModelChange(nextValue === AUTO_MODEL_DROPDOWN_VALUE ? "" : nextValue);
  }

  if (!modelFieldVisible && !llmProviderFieldVisible) {
    return null;
  }

  return (
    <>
      {llmProviderFieldVisible ? (
        <div className="space-y-1.5">
          <label
            className="text-sm font-medium text-foreground"
            htmlFor="agent-llm-provider"
          >
            LLM provider
            <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
          </label>
          <PersonaDropdownField
            disabled={disabled}
            id="agent-llm-provider"
            onValueChange={handleProviderDropdownChange}
            options={providerDropdownOptions}
            placeholder={getDefaultLlmProviderLabel(trimmedRuntime)}
            value={providerSelectValue}
          />
          {llmProviderFieldVisible && isCustomProviderEditing ? (
            <div
              className={cn(
                "mt-2 flex min-h-11 items-center px-3",
                PERSONA_FIELD_SHELL_CLASS,
              )}
            >
              <Input
                aria-label="Custom provider ID"
                autoCorrect="off"
                className={cn(
                  "h-8 px-0 py-0 leading-6",
                  PERSONA_FIELD_CONTROL_CLASS,
                )}
                disabled={disabled}
                id="agent-custom-provider"
                onChange={(event) => onProviderChange(event.target.value)}
                placeholder="Custom provider ID"
                value={provider}
              />
            </div>
          ) : null}
          {providerApiKeyConfig ? (
            <PersonaProviderApiKeyField
              config={providerApiKeyConfig}
              disabled={disabled}
              onChange={(value) =>
                updateProviderApiKey(providerApiKeyConfig.envVar, value)
              }
              value={providerApiKeyValue}
            />
          ) : null}
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {modelFieldVisible ? (
          <PersonaModelField
            disabled={disabled}
            isExplicitModelRequired={isExplicitModelRequired}
            model={model}
            modelDiscoveryStatus={modelDiscoveryStatus}
            modelDropdownOptions={modelDropdownOptions}
            modelSelectValue={modelSelectValue}
            onCustomModelChange={onModelChange}
            onModelValueChange={handleModelDropdownChange}
            showCustomModelInput={showCustomModelInput}
            transition={FIELD_TRANSITION}
          />
        ) : null}
      </AnimatePresence>
    </>
  );
}
