import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button, IconPresentationProvider, Icons, ToolButton, useModal } from '@ohif/ui-next';
import { Types, useSystem } from '@ohif/core';
import { Toolbar, usePatientInfo } from '@ohif/extension-default';
import { preserveQueryParameters } from '@ohif/app';

import { DentalPreferences } from '../preferences/dentalPreferences';
import DentalMeasurementsPalette from '../measurements/DentalMeasurementsPalette';
import { DentalMeasurementPresetId } from '../measurements/dentalMeasurementPresets';
import { ToothNumberingSystem } from '../tooth/toothIdentity';
import { DentalViewerStateStatus } from '../viewerState/useDentalViewerState';
import { formatHeaderValue, getPracticeName, getStudySummary } from './practiceHeaderUtils';
import ToothSelector from './ToothSelector';

const HEADER_CLASS_BY_THEME = {
  dental: 'h-[96px] w-full border-b border-[#24a78d] bg-[#10201c] px-3',
  standard: 'bg-background border-muted h-[96px] w-full border-b px-3',
};

const PRACTICE_NAME_CLASS_BY_THEME = {
  dental: 'truncate text-sm font-semibold text-[#bff4e7]',
  standard: 'text-primary truncate text-sm font-semibold',
};

const MODE_LABEL_CLASS_BY_THEME = {
  dental: 'text-[11px] text-[#76d6c1]',
  standard: 'text-muted-foreground text-[11px]',
};

function getStateStatusText(
  stateStatus: DentalViewerStateStatus,
  stateMessage: string | null
): string | null {
  if (stateStatus === 'loading') {
    return 'Loading';
  }

  if (stateStatus === 'locked') {
    return 'Locked';
  }

  if (stateStatus === 'unsaved') {
    return stateMessage || 'Not saved';
  }

  return null;
}

type PracticeHeaderProps = withAppTypes<{
  appConfig: AppTypes.Config;
  preferences: DentalPreferences;
  stateStatus: DentalViewerStateStatus;
  stateMessage: string | null;
  onSelectedToothChange: (toothId: string) => void;
  onNumberingSystemChange: (numberingSystem: ToothNumberingSystem) => void;
  onThemeToggle: () => void;
  onSelectMeasurementPreset: (presetId: DentalMeasurementPresetId, note: string) => void;
}>;

function PracticeHeader({
  appConfig,
  preferences,
  stateStatus,
  stateMessage,
  onSelectedToothChange,
  onNumberingSystemChange,
  onThemeToggle,
  onSelectMeasurementPreset,
}: PracticeHeaderProps) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
  const { customizationService, displaySetService } = servicesManager.services;
  const { show } = useModal();
  const { patientInfo } = usePatientInfo();
  const navigate = useNavigate();
  const location = useLocation();

  const practiceName = getPracticeName(appConfig);
  const isDentalTheme = preferences.theme === 'dental';
  const stateStatusText = useMemo(
    () => getStateStatusText(stateStatus, stateMessage),
    [stateMessage, stateStatus]
  );

  const [studySummary, setStudySummary] = useState(() => getStudySummary(displaySetService));
  const refreshStudySummary = useCallback(() => {
    setStudySummary(getStudySummary(displaySetService));
  }, [displaySetService]);

  useEffect(() => {
    refreshStudySummary();
    const subscriptions = [
      displaySetService.subscribe?.(
        displaySetService.EVENTS.DISPLAY_SETS_ADDED,
        refreshStudySummary
      ),
      displaySetService.subscribe?.(
        displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
        refreshStudySummary
      ),
    ].filter(Boolean);

    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [displaySetService, refreshStudySummary]);

  const onClickReturnButton = () => {
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);
    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }
    preserveQueryParameters(searchQuery);

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const onClickSettings = () => {
    const UserPreferencesModal = customizationService.getCustomization(
      'ohif.userPreferencesModal'
    ) as Types.MenuComponentCustomization;

    if (!UserPreferencesModal) {
      return;
    }

    show({
      content: UserPreferencesModal,
      title: UserPreferencesModal.title ?? 'User preferences',
      containerClassName: UserPreferencesModal.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
    });
  };

  return (
    <IconPresentationProvider
      size="large"
      IconContainer={ToolButton}
    >
      <header
        className={HEADER_CLASS_BY_THEME[preferences.theme]}
        data-cy="dental-practice-header"
      >
        <div className="grid h-11 grid-cols-[minmax(180px,1fr)_minmax(180px,auto)_minmax(0,1fr)] items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {appConfig.showStudyList ? (
              <Button
                variant="ghost"
                size="icon"
                className="text-primary hover:bg-muted flex-shrink-0"
                data-cy="return-to-work-list"
                onClick={onClickReturnButton}
              >
                <Icons.ArrowLeft className="h-6 w-6" />
              </Button>
            ) : null}
            <div className="flex min-w-0 flex-col">
              <span className={PRACTICE_NAME_CLASS_BY_THEME[preferences.theme]}>
                {practiceName}
              </span>
              <span className={MODE_LABEL_CLASS_BY_THEME[preferences.theme]}>Dental Mode</span>
            </div>
          </div>

          <div
            className="hidden min-w-0 max-w-[280px] flex-col text-center lg:flex"
            data-cy="dental-patient-summary"
          >
            <span className="text-foreground truncate text-[13px] font-semibold">
              {formatHeaderValue(patientInfo.PatientName, 'Patient')}
            </span>
            <span className="text-muted-foreground truncate text-[11px]">
              {formatHeaderValue(patientInfo.PatientID, 'No ID')} |{' '}
              {formatHeaderValue(studySummary.modality, 'No modality')} |{' '}
              {formatHeaderValue(studySummary.studyDate, 'No study date')}
            </span>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden xl:gap-2">
            {stateStatusText ? (
              <span
                className="border-muted text-muted-foreground hidden h-7 max-w-[96px] items-center truncate rounded border px-2 text-[11px] 2xl:flex"
                data-cy="dental-viewer-state-status"
                title={stateStatusText}
              >
                {stateStatusText}
              </span>
            ) : null}

            <ToothSelector
              preferences={preferences}
              onSelectedToothChange={onSelectedToothChange}
              onNumberingSystemChange={onNumberingSystemChange}
            />

            <Button
              variant={isDentalTheme ? 'default' : 'ghost'}
              className="h-9 flex-shrink-0 px-2 text-xs"
              data-cy="dental-theme-toggle"
              onClick={onThemeToggle}
            >
              {isDentalTheme ? 'Dental' : 'Theme'}
            </Button>
          </div>
        </div>

        <div className="border-muted/50 grid h-[51px] grid-cols-[1fr_auto_1fr] items-center border-t">
          <div />
          <div className="flex min-w-0 items-center justify-center gap-1 overflow-hidden">
            <Toolbar buttonSection="primary" />
            <DentalMeasurementsPalette onSelectPreset={onSelectMeasurementPreset} />
          </div>
          <div className="flex items-center justify-end">
            <div className="text-primary flex cursor-pointer items-center">
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-muted"
                data-cy="undo-btn"
                onClick={() => commandsManager.run('undo')}
              >
                <Icons.Undo />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-muted"
                data-cy="redo-btn"
                onClick={() => commandsManager.run('redo')}
              >
                <Icons.Redo />
              </Button>
            </div>

            <div className="border-muted mx-1.5 h-[25px] border-r" />

            <Button
              variant="ghost"
              size="icon"
              className="text-primary hover:bg-muted"
              data-cy="dental-header-settings"
              aria-label="Open user preferences"
              onClick={onClickSettings}
            >
              <Icons.GearSettings />
            </Button>
          </div>
        </div>
      </header>
    </IconPresentationProvider>
  );
}

export default PracticeHeader;
