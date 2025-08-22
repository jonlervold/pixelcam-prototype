import { useEffect, useRef, useState } from 'react';

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [targetWidth, setTargetWidth] = useState<number>(32);
  const [videoLoaded, setVideoLoaded] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    // Get available cameras
    async function getCameras() {
      try {
        // First request camera permission to get labels
        await navigator.mediaDevices.getUserMedia({ video: true })
          .then(stream => {
            // Stop this initial stream
            stream.getTracks().forEach(track => track.stop());
          });

        // Now we can get the device list with labels
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setCameras(videoDevices);
        
        // Select the back camera by default on mobile, or the first camera on desktop
        const backCamera = videoDevices.find(device => device.label.toLowerCase().includes('back'));
        setSelectedCamera(backCamera?.deviceId || videoDevices[0]?.deviceId);
      } catch (err) {
        console.error('Error accessing cameras:', err);
      }
    }

    getCameras();
  }, []);

  useEffect(() => {
    // Start camera stream when a camera is selected
    async function startCamera() {
      if (!selectedCamera) return;
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: selectedCamera,
            width: { min: 640, ideal: 1920, max: 1920 },
            height: { min: 480, ideal: 1080, max: 1080 },
            facingMode: 'environment'
          }
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Error accessing camera:', err);
      }
    }

    startCamera();

    // Cleanup function to stop the camera when component unmounts
    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [selectedCamera]);

  useEffect(() => {
    const processFrame = () => {
      if (!videoRef.current || !canvasRef.current || !displayCanvasRef.current || !videoRef.current.videoWidth || !videoLoaded) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const displayCanvas = displayCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const displayCtx = displayCanvas.getContext('2d');

      if (!ctx || !displayCtx) return;

      // Set canvas sizes
      const videoAspect = video.videoWidth / video.videoHeight;
      const displayWidth = Math.min(1920, video.videoWidth);
      const displayHeight = displayWidth / videoAspect;

      // Set the downscaled size
      canvas.width = targetWidth;
      canvas.height = Math.floor(targetWidth / videoAspect);

      // Set the display size (HD or original)
      displayCanvas.width = displayWidth;
      displayCanvas.height = displayHeight;

      // Draw and downscale
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Upscale with nearest neighbor
      displayCtx.imageSmoothingEnabled = false;
      displayCtx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();
  }, [targetWidth, videoLoaded]);

  const handleCameraChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCamera(event.target.value);
  };

  const handleTargetWidthChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setTargetWidth(Number(event.target.value));
  };

  const captureImage = () => {
    if (!displayCanvasRef.current) return;
    
    try {
      const link = document.createElement('a');
      link.download = `pixelcam-${new Date().toISOString()}.png`;
      link.href = displayCanvasRef.current.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Error saving image:', err);
    }
  };

  return (
    <div className="app">
      <div className="camera-controls">
        <select value={selectedCamera} onChange={handleCameraChange}>
          {cameras.map(camera => (
            <option key={camera.deviceId} value={camera.deviceId}>
              {camera.label || `Camera ${camera.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
        <div className="pixel-control">
          <label>
            Resolution: {targetWidth}px wide
            <input
              type="range"
              min="2"
              max="640"
              value={targetWidth}
              onChange={handleTargetWidthChange}
              style={{ width: '100%' }}
            />
          </label>
      </div>
        <button onClick={captureImage} className="capture-button">
          Take Photo
        </button>
      </div>
      <div className="camera-container">
                  <video 
          ref={videoRef}
          autoPlay 
          playsInline // Required for iOS
          muted // Required for autoplay
          onLoadedData={() => setVideoLoaded(true)}
        />
        <canvas 
          ref={canvasRef}
          style={{ display: 'none' }} // Hidden canvas for processing
        />
        <canvas
          ref={displayCanvasRef}
          className="display-canvas"
        />
      </div>
    </div>
  );
}

export default App
