"""macOS camera authorization separated from OpenCV capture."""

from __future__ import annotations

import sys
import threading
from enum import StrEnum


class CameraPermission(StrEnum):
    GRANTED = "granted"
    REQUIRED = "permission-required"
    DENIED = "permission-denied"
    UNAVAILABLE = "unavailable"


def request_camera_permission(timeout_seconds: float = 30.0) -> CameraPermission:
    if sys.platform != "darwin":
        return CameraPermission.GRANTED
    try:
        from AVFoundation import (
            AVAuthorizationStatusAuthorized,
            AVAuthorizationStatusDenied,
            AVAuthorizationStatusNotDetermined,
            AVAuthorizationStatusRestricted,
            AVCaptureDevice,
            AVMediaTypeVideo,
        )
    except ImportError:
        return CameraPermission.UNAVAILABLE

    status = AVCaptureDevice.authorizationStatusForMediaType_(AVMediaTypeVideo)
    if status == AVAuthorizationStatusAuthorized:
        return CameraPermission.GRANTED
    if status in {AVAuthorizationStatusDenied, AVAuthorizationStatusRestricted}:
        return CameraPermission.DENIED
    if status != AVAuthorizationStatusNotDetermined:
        return CameraPermission.UNAVAILABLE

    completed = threading.Event()
    result = {"granted": False}

    def callback(granted: bool) -> None:
        result["granted"] = bool(granted)
        completed.set()

    AVCaptureDevice.requestAccessForMediaType_completionHandler_(
        AVMediaTypeVideo, callback
    )
    if not completed.wait(timeout_seconds):
        return CameraPermission.REQUIRED
    return CameraPermission.GRANTED if result["granted"] else CameraPermission.DENIED
