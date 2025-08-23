import { useEffect, useRef, useState } from 'react';

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [targetWidth, setTargetWidth] = useState<number>(150);
  const [videoLoaded, setVideoLoaded] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isGrayscale, setIsGrayscale] = useState<boolean>(false);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [reducedColors, setReducedColors] = useState<boolean>(false);
  const [colorCount, setColorCount] = useState<number>(8);
  const colorTableRef = useRef<Uint8Array>();
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
        // First stop any existing stream
        if (videoRef.current?.srcObject) {
          const oldStream = videoRef.current.srcObject as MediaStream;
          oldStream.getTracks().forEach(track => track.stop());
          videoRef.current.srcObject = null;
        }

        // Request the new stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedCamera }, // Use exact to ensure we get the selected camera
            width: { min: 640, ideal: 1920, max: 1920 },
            height: { min: 480, ideal: 1080, max: 1080 }
          }
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setVideoLoaded(false); // Reset video loaded state for new stream
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


  // Update color lookup table when color count or reduced colors setting changes
  useEffect(() => {
    if (!reducedColors) {
      colorTableRef.current = undefined;
      return;
    }

    // Create lookup table for faster color quantization
    const table = new Uint8Array(256);
    const step = 256 / (colorCount - 1);
    
    for (let i = 0; i < 256; i++) {
      // Ensure we don't exceed 255 for bright values
      table[i] = Math.min(255, Math.round(Math.round(i / step) * step));
    }
    
    colorTableRef.current = table;
  }, [colorCount, reducedColors]);

  useEffect(() => {
    let isActive = true;  // Flag to track if effect is active

    const processFrame = () => {
      if (!isActive) return;  // Stop if effect is no longer active
      
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

      // Determine if we should rotate (portrait mode)
      const isPortrait = video.videoHeight > video.videoWidth;
      
      // For portrait mode, we'll rotate the image so width becomes height
      if (isPortrait) {
        canvas.width = Math.floor(targetWidth * (video.videoHeight / video.videoWidth));
        canvas.height = targetWidth;
      } else {
        canvas.width = targetWidth;
        canvas.height = Math.floor(targetWidth * (video.videoHeight / video.videoWidth));
      }

      // Set display canvas size to maintain aspect ratio
      const maxDimension = 1920;
      if (isPortrait) {
        displayCanvas.width = Math.floor(maxDimension * (video.videoHeight / video.videoWidth));
        displayCanvas.height = maxDimension;
      } else {
        displayCanvas.width = maxDimension;
        displayCanvas.height = Math.floor(maxDimension * (video.videoHeight / video.videoWidth));
      }

      // Clear both canvases
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      
      // Apply filters
      if (isGrayscale) {
        ctx.filter = 'grayscale(100%)';
      } else {
        ctx.filter = 'none';
      }
      
      // Draw and downscale with rotation if needed
      ctx.save();
      if (isPortrait) {
        // Rotate 90 degrees clockwise and translate
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(video, 0, 0, canvas.height, canvas.width);
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      ctx.restore();

      // Apply color quantization if reduced colors is enabled
      if (reducedColors && colorTableRef.current) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const table = colorTableRef.current;
        
        // Use the lookup table for faster color quantization
        for (let i = 0; i < data.length; i += 4) {
          data[i] = table[data[i]];         // R
          data[i + 1] = table[data[i + 1]]; // G
          data[i + 2] = table[data[i + 2]]; // B
        }
        
        ctx.putImageData(imageData, 0, 0);
      }

      // Upscale with nearest neighbor and rotation if needed
      displayCtx.save();
      displayCtx.imageSmoothingEnabled = false;
      
      if (isPortrait) {
        // Rotate -90 degrees to make it upright
        displayCtx.translate(0, displayCanvas.height);
        displayCtx.rotate(-Math.PI / 2);
        displayCtx.drawImage(canvas, 0, 0, displayCanvas.height, displayCanvas.width);
      } else {
        displayCtx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
      }
      displayCtx.restore();

      if (isActive) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
      }
    };

    processFrame();

    // Cleanup function
    return () => {
      isActive = false;  // Mark effect as inactive
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [targetWidth, videoLoaded, isGrayscale, isFlipped, colorCount, reducedColors]);

  const handleCameraChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCamera(event.target.value);
  };

  const handleTargetWidthChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // For range input: value is already constrained
    setTargetWidth(Number(event.target.value));
  };

  const handleColorCountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setColorCount(Number(event.target.value));
  };

  const startUpdatingColors = (increment: boolean) => {
    const updateValue = () => {
      setColorCount(prev => {
        const newValue = increment ? prev + 1 : prev - 1;
        return Math.min(Math.max(newValue, 2), 20);
      });
    };

    // First update
    updateValue();

    // Then start interval after a delay
    const timeoutId = setTimeout(() => {
      const intervalId = setInterval(updateValue, 50);
      
      const cleanup = () => {
        clearInterval(intervalId);
        document.removeEventListener('mouseup', cleanup);
        document.removeEventListener('touchend', cleanup);
      };

      document.addEventListener('mouseup', cleanup);
      document.addEventListener('touchend', cleanup);
    }, 250);

    const cleanup = () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mouseup', cleanup);
      document.removeEventListener('touchend', cleanup);
    };

    document.addEventListener('mouseup', cleanup);
    document.addEventListener('touchend', cleanup);
  };

  // Handle button hold functionality
  const startUpdatingWidth = (increment: boolean) => {
    const updateValue = () => {
      setTargetWidth(prev => {
        const newValue = increment ? prev + 1 : prev - 1;
        return Math.min(Math.max(newValue, 2), 640);
      });
    };

    // First update
    updateValue();

    // Then start interval after a delay
    const timeoutId = setTimeout(() => {
      const intervalId = setInterval(updateValue, 50); // Update every 50ms while holding
      
      // Store the interval ID so we can clear it on mouse up
      const cleanup = () => {
        clearInterval(intervalId);
        document.removeEventListener('mouseup', cleanup);
        document.removeEventListener('touchend', cleanup);
      };

      document.addEventListener('mouseup', cleanup);
      document.addEventListener('touchend', cleanup);
    }, 250); // Start repeating after 250ms hold

    // Store the timeout ID so we can clear it if mouse up happens before interval starts
    const cleanup = () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mouseup', cleanup);
      document.removeEventListener('touchend', cleanup);
    };

    document.addEventListener('mouseup', cleanup);
    document.addEventListener('touchend', cleanup);
  };

  const captureImage = () => {
    if (!displayCanvasRef.current) return;
    
    try {
      // Create a temporary canvas for the final image
      const finalCanvas = document.createElement('canvas');
      const finalCtx = finalCanvas.getContext('2d');
      if (!finalCtx) return;

      // Get dimensions from the processed canvas
      const isPortrait = canvasRef.current.height > canvasRef.current.width;
      
      // Set dimensions to maintain aspect ratio at 1920px on the long edge
      if (isPortrait) {
        finalCanvas.height = 1920;
        finalCanvas.width = Math.round(1920 * (canvasRef.current.width / canvasRef.current.height));
      } else {
        finalCanvas.width = 1920;
        finalCanvas.height = Math.round(1920 * (canvasRef.current.height / canvasRef.current.width));
      }

      // Apply flip if needed
      if (isFlipped) {
        finalCtx.scale(-1, 1);
        finalCtx.translate(-finalCanvas.width, 0);
      }

      // Draw the display canvas content with nearest-neighbor scaling
      finalCtx.imageSmoothingEnabled = false;
      finalCtx.drawImage(displayCanvasRef.current, 0, 0, finalCanvas.width, finalCanvas.height);

      // Create download link
      const link = document.createElement('a');
      link.download = `pixelcam-${new Date().toISOString()}.png`;
      link.href = finalCanvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Error saving image:', err);
    }
  };

  return (
        <div className="app">
      <button 
        className="menu-toggle"
        onClick={() => setMenuOpen(prev => !prev)}
      >
        {menuOpen ? '▼ Settings' : '▲ Settings'}
      </button>

      <div className={`camera-controls ${menuOpen ? 'open' : ''}`}>
        <select value={selectedCamera} onChange={handleCameraChange}>
          {cameras.map(camera => (
            <option key={camera.deviceId} value={camera.deviceId}>
              {camera.label || `Camera ${camera.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
        <div className="pixel-control">
          <div className="effect-controls">
            <label className="effect-control">
              <input
                type="checkbox"
                checked={reducedColors}
                onChange={(e) => setReducedColors(e.target.checked)}
              />
              Use Reduced Colors
            </label>
            <label className="effect-control">
              <input
                type="checkbox"
                checked={isGrayscale}
                onChange={(e) => setIsGrayscale(e.target.checked)}
              />
              Grayscale
            </label>
            <label className="effect-control">
              <input
                type="checkbox"
                checked={isFlipped}
                onChange={(e) => setIsFlipped(e.target.checked)}
              />
              Flip Horizontal
            </label>
          </div>
          <div className="resolution-controls">
            <label className="resolution-input">
              Resolution:
              <div className="number-control">
                <button 
                  onMouseDown={() => startUpdatingWidth(false)}
                  onTouchStart={() => startUpdatingWidth(false)}
                  disabled={targetWidth <= 2}
                >
                  -
                </button>
                <span>{targetWidth}px</span>
                <button 
                  onMouseDown={() => startUpdatingWidth(true)}
                  onTouchStart={() => startUpdatingWidth(true)}
                  disabled={targetWidth >= 640}
                >
                  +
                </button>
              </div>
              wide
            </label>
            <input
              type="range"
              min="2"
              max="640"
              value={targetWidth}
              onChange={handleTargetWidthChange}
              style={{ width: '100%' }}
            />
          </div>
          {reducedColors && (
            <div className="resolution-controls">
              <label className="resolution-input">
                Colors:
                <div className="number-control">
                  <button 
                    onMouseDown={() => startUpdatingColors(false)}
                    onTouchStart={() => startUpdatingColors(false)}
                    disabled={colorCount <= 2}
                  >
                    -
                  </button>
                  <span>{colorCount}</span>
                  <button 
                    onMouseDown={() => startUpdatingColors(true)}
                    onTouchStart={() => startUpdatingColors(true)}
                    disabled={colorCount >= 20}
                  >
                    +
                  </button>
                </div>
              </label>
              <input
                type="range"
                min="2"
                max="20"
                step="1"
                value={colorCount}
                onChange={handleColorCountChange}
                style={{ width: '100%' }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="camera-container">
        <video 
          ref={videoRef}
          autoPlay 
          playsInline // Required for iOS
          muted // Required for autoplay
          onLoadedData={() => setVideoLoaded(true)}
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none'
          }}
        />
        <canvas 
          ref={canvasRef}
          style={{ display: 'none' }} // Hidden canvas for processing
        />
        <canvas
          ref={displayCanvasRef}
          className="display-canvas"
          style={{
            transform: isFlipped ? 'scaleX(-1)' : 'none',
            transition: 'transform 0.2s'
          }}
        />
      </div>

      <button onClick={captureImage} className="capture-button">
        Take Photo
        </button>
      </div>
  );
}

export default App
