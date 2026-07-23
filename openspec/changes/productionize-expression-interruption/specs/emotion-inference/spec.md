## ADDED Requirements

### Requirement: Registered inference adapter
The inference process SHALL instantiate emotion providers through the adapter registry, SHALL ship with `emotiefflib` as the only registered adapter, and MUST return a clear configuration error for any unregistered adapter name.

#### Scenario: Default adapter starts
- **WHEN** the runtime starts without an adapter override
- **THEN** it instantiates the EmotiEffLib adapter through the registry

#### Scenario: Unknown adapter is rejected
- **WHEN** configuration names an adapter that is not registered
- **THEN** startup fails before opening the camera and reports the valid adapter names

### Requirement: Canonical emotion model
The inference module SHALL normalize provider output into the canonical emotions `anger`, `contempt`, `disgust`, `fear`, `happiness`, `neutral`, `sadness`, and `surprise`. Every active reading MUST contain a finite score from 0.0 through 1.0 for every canonical emotion, a canonical dominant emotion, the provider name, the selected face box, and inference duration.

#### Scenario: Provider output is normalized
- **WHEN** EmotiEffLib returns a valid probability vector
- **THEN** the module emits all eight canonical scores and identifies the highest canonical score as dominant

#### Scenario: Invalid provider output is contained
- **WHEN** a provider returns missing, non-finite, or out-of-range scores
- **THEN** the module rejects that result, emits a structured inference error, and does not publish it as an active reading

### Requirement: Single primary face selection
The inference process SHALL use MTCNN to detect faces, SHALL accept only detections at or above the configured face-confidence threshold and meeting the minimum-size constraint, SHALL clamp boxes to frame bounds, and SHALL analyze only the largest eligible face in each inference cycle.

#### Scenario: Multiple eligible faces are visible
- **WHEN** a frame contains more than one face at or above the default 0.90 confidence threshold and meeting the 40-pixel minimum size
- **THEN** only the face with the largest bounded area is passed to EmotiEffLib

#### Scenario: Detection extends beyond the frame
- **WHEN** MTCNN returns coordinates outside the captured image
- **THEN** the coordinates are clamped before area calculation and cropping

### Requirement: Bounded inference cadence
The inference process SHALL own exactly one camera capture and one loaded EmotiEffLib model per runtime instance. It SHALL begin no more than one inference per configured interval, defaulting to 0.16 seconds, and SHALL never overlap inference calls for the same runtime instance.

#### Scenario: Camera frames arrive faster than inference cadence
- **WHEN** frames are available more frequently than the configured interval
- **THEN** excess frames are skipped rather than queued for later inference

#### Scenario: Inference exceeds the configured interval
- **WHEN** one inference takes longer than the configured interval
- **THEN** the next inference begins only after the current inference completes using the newest available frame

### Requirement: Camera permission and failure states
The inference process SHALL request macOS camera permission through AVFoundation before worker capture, SHALL distinguish loading, permission-required, permission-denied, camera-unavailable, active, no-face, and inference-error states, and SHALL publish state changes to consumers. It SHALL bind the emotion stream and begin publishing a freshness-preserving loading heartbeat before permission checks, camera opening, heavyweight provider imports, or model construction. Heartbeat publication MUST NOT be sequenced behind those operations or first-frame inference. Loading SHALL remain current through first-frame processing and SHALL end only when the producer publishes its first active reading, no-face state, permission state, camera error, or inference error.

#### Scenario: Cold startup initializes the emotion stack
- **WHEN** provider imports and model construction take longer than the stream freshness deadline
- **THEN** consumers remain connected to fresh loading events and the notch continues to show loading throughout initialization

#### Scenario: Startup work delays the Python scheduler
- **WHEN** provider initialization temporarily delays a scheduled loading heartbeat
- **THEN** the default 1.5-second freshness window tolerates the measured cold-start scheduling gap without presenting a false stale state

#### Scenario: First inference is still pending
- **WHEN** camera and adapter initialization has completed but no active, no-face, or error result has been published
- **THEN** loading remains fresh until that first result replaces it

#### Scenario: Permission has not been decided
- **WHEN** the runtime first accesses a camera requiring user authorization
- **THEN** it requests permission on an AppKit-compatible thread and does not start OpenCV capture until permission is granted

#### Scenario: Camera cannot be opened
- **WHEN** OpenCV cannot open the configured camera
- **THEN** the process publishes `camera-unavailable`, does not fabricate readings, and remains observable to the runtime owner

### Requirement: No-face semantics
The inference process SHALL publish a no-face state after no eligible face has been observed for the configured timeout, defaulting to 0.8 seconds. It MUST NOT repeat the last active emotion scores as though they were current after that timeout.

#### Scenario: Face temporarily disappears
- **WHEN** no eligible face is found for less than the no-face timeout
- **THEN** the process withholds a replacement reading without immediately declaring no-face

#### Scenario: Face remains absent
- **WHEN** no eligible face is found for at least the no-face timeout
- **THEN** the process publishes no-face and downstream temporal state is eligible to reset

### Requirement: On-device privacy
The production inference path MUST keep camera frames and face crops on device, MUST NOT write them to disk, and MUST NOT include image pixels in stream messages or logs. Only normalized scores and bounded metadata required by consumers MAY leave the inference process.

#### Scenario: Normal inference runs
- **WHEN** the camera and model produce active readings
- **THEN** no frame or crop artifact is created on disk or sent over a network interface

#### Scenario: Diagnostic logging is enabled
- **WHEN** verbose or structured logging is active
- **THEN** logs contain timing, state, and error metadata but no image pixels or biometric crops

### Requirement: Adapter lifecycle
The runtime SHALL close the active adapter and camera exactly once during graceful shutdown and SHALL release them before process exit.

#### Scenario: Runtime receives a termination request
- **WHEN** graceful shutdown begins during active inference
- **THEN** the current operation is allowed to finish or cancel safely, the camera is released, the adapter is closed, and no new inference begins
