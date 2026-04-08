#pragma once

#include <functional>
#include <string>

class OtaUpdater {
  bool updateAvailable = false;
  std::string latestVersion;
  std::string otaUrl;
  size_t otaSize = 0;
  size_t processedSize = 0;
  size_t totalSize = 0;
  bool render = false;
  int lastHttpStatus = 0;
  std::string errorDetail;
  std::string serverHost;

 public:
  enum OtaUpdaterError {
    OK = 0,
    NO_UPDATE,
    HTTP_ERROR,
    HTTP_STATUS_ERROR,
    EMPTY_RESPONSE,
    JSON_PARSE_ERROR,
    MISSING_FIELDS,
    UPDATE_OLDER_ERROR,
    INTERNAL_UPDATE_ERROR,
    OOM_ERROR,
  };

  size_t getOtaSize() const { return otaSize; }

  size_t getProcessedSize() const { return processedSize; }

  size_t getTotalSize() const { return totalSize; }

  bool getRender() const { return render; }

  int getLastHttpStatus() const { return lastHttpStatus; }

  const std::string& getErrorDetail() const { return errorDetail; }

  const std::string& getServerHost() const { return serverHost; }

  OtaUpdater() = default;
  bool isUpdateNewer() const;
  const std::string& getLatestVersion() const;
  OtaUpdaterError checkForUpdate();
  OtaUpdaterError installUpdate();
};
