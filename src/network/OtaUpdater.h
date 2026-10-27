#pragma once

#include <string>

class OtaUpdater {
  bool updateAvailable = false;
  std::string latestVersion;
  std::string otaUrl;
  size_t otaSize = 0;
  size_t processedSize = 0;
  size_t totalSize = 0;
  // Diagnostics for the update screen: host of the release URL in use and a
  // short, untranslated detail of the last checkForUpdate() failure.
  std::string serverHost;
  std::string errorDetail;

 public:
  using ProgressCallback = void (*)(void* ctx);

  enum OtaUpdaterError {
    OK = 0,
    NO_UPDATE,
    HTTP_ERROR,
    EMPTY_RESPONSE,
    JSON_PARSE_ERROR,
    MISSING_FIELDS,
    UPDATE_OLDER_ERROR,
    INTERNAL_UPDATE_ERROR,
    OOM_ERROR,
    WRONG_DEVICE_ERROR,
  };

  size_t getOtaSize() const { return otaSize; }

  const std::string& getServerHost() const { return serverHost; }

  const std::string& getErrorDetail() const { return errorDetail; }

  size_t getProcessedSize() const { return processedSize; }

  size_t getTotalSize() const { return totalSize; }

  OtaUpdater() = default;
  bool isUpdateNewer() const;
  const std::string& getLatestVersion() const;
  OtaUpdaterError checkForUpdate();
  OtaUpdaterError installUpdate(ProgressCallback onProgress = nullptr, void* ctx = nullptr);
};
