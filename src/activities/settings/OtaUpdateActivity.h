#pragma once

#include "activities/Activity.h"
#include "components/OptionPopup.h"
#include "network/OtaUpdater.h"

class OtaUpdateActivity : public Activity {
  enum State {
    WIFI_SELECTION,
    CHECKING_FOR_UPDATE,
    WAITING_CONFIRMATION,
    UPDATE_IN_PROGRESS,
    NO_UPDATE,
    FAILED,
    FINISHED,
    SHUTTING_DOWN
  };

  // Can't initialize this to 0 or the first render doesn't happen
  static constexpr unsigned int UNINITIALIZED_PERCENTAGE = 111;

  State state = WIFI_SELECTION;
  unsigned int lastUpdaterPercentage = UNINITIALIZED_PERCENTAGE;
  OtaUpdater updater;
  // Result of the failed check/install, rendered as a reason line under the
  // generic "Update failed" heading.
  OtaUpdater::OtaUpdaterError lastError = OtaUpdater::OK;
  // Cancel/Update confirmation over the version info (replaces the old
  // hand-rolled bottom tap rects).
  OptionPopup confirmPopup;

  void onWifiSelectionComplete(bool success);
  void runUpdateInstall();
  const char* failureReason() const;

 public:
  explicit OtaUpdateActivity(GfxRenderer& renderer, MappedInputManager& mappedInput)
      : Activity("OtaUpdate", renderer, mappedInput), updater() {}
  void onEnter() override;
  void onExit() override;
  void loop() override;
  void render(RenderLock&&) override;
  bool preventAutoSleep() override { return state == CHECKING_FOR_UPDATE || state == UPDATE_IN_PROGRESS; }
  bool skipLoopDelay() override { return true; }  // Prevent power-saving mode
};
