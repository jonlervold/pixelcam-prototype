import { useEffect, useRef, useState } from 'react';
import GIF from 'gif.js';

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
  const [hueShift, setHueShift] = useState<number>(0);
  const [useHueShift, setUseHueShift] = useState<boolean>(false);
  const [isInverted, setIsInverted] = useState<boolean>(false);
  const [isLuminanceInverted, setIsLuminanceInverted] = useState<boolean>(false);
  const [isBurstMode, setIsBurstMode] = useState<boolean>(false);
  const [burstFrames, setBurstFrames] = useState<number>(10);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
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
      const filters = [];
      if (isGrayscale) {
        filters.push('grayscale(100%)');
      }
      if (useHueShift && hueShift !== 0) {
        filters.push(`hue-rotate(${hueShift}deg)`);
      }
      ctx.filter = filters.length > 0 ? filters.join(' ') : 'none';
      
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
      
      // Reset filter to prevent affecting subsequent operations
      ctx.filter = 'none';
      
      // Apply color inversion using pixel manipulation to avoid affecting black areas
      if (isInverted) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          // Copy current canvas content
          tempCtx.drawImage(canvas, 0, 0);
          
          // Apply invert filter to temp canvas
          tempCtx.filter = 'invert(100%)';
          tempCtx.globalCompositeOperation = 'source-atop';
          tempCtx.drawImage(canvas, 0, 0);
          tempCtx.filter = 'none';
          tempCtx.globalCompositeOperation = 'source-over';
          
          // Get image data from both canvases
          const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const filteredData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Replace only non-black pixels
          for (let i = 0; i < originalData.data.length; i += 4) {
            const r = originalData.data[i];
            const g = originalData.data[i + 1];
            const b = originalData.data[i + 2];
            
            // If pixel is not black (with small threshold), use filtered version
            if (r > 5 || g > 5 || b > 5) {
              originalData.data[i] = filteredData.data[i];
              originalData.data[i + 1] = filteredData.data[i + 1];
              originalData.data[i + 2] = filteredData.data[i + 2];
            }
          }
          
          // Put the modified data back
          ctx.putImageData(originalData, 0, 0);
        }
      }

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

      // Apply luminance inversion if enabled
      if (isLuminanceInverted) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Skip black pixels (with small threshold) to preserve black areas
          if (r <= 5 && g <= 5 && b <= 5) {
            continue;
          }
          
          // Convert RGB to HSL
          const max = Math.max(r, g, b) / 255;
          const min = Math.min(r, g, b) / 255;
          const diff = max - min;
          
          // Calculate lightness
          let lightness = (max + min) / 2;
          
          // Invert only the lightness
          lightness = 1 - lightness;
          
          // Convert back to RGB with inverted lightness
          let newR, newG, newB;
          
          if (diff === 0) {
            // Grayscale - just invert lightness
            newR = newG = newB = Math.round(lightness * 255);
          } else {
            // Calculate saturation
            const saturation = lightness > 0.5 ? diff / (2 - max - min) : diff / (max + min);
            
            // Calculate hue
            let hue = 0;
            if (max === r / 255) {
              hue = ((g / 255 - b / 255) / diff + (g < b ? 6 : 0)) / 6;
            } else if (max === g / 255) {
              hue = ((b / 255 - r / 255) / diff + 2) / 6;
            } else {
              hue = ((r / 255 - g / 255) / diff + 4) / 6;
            }
            
            // Convert HSL back to RGB
            const hue2rgb = (p: number, q: number, t: number) => {
              if (t < 0) t += 1;
              if (t > 1) t -= 1;
              if (t < 1/6) return p + (q - p) * 6 * t;
              if (t < 1/2) return q;
              if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
              return p;
            };
            
            if (saturation === 0) {
              newR = newG = newB = Math.round(lightness * 255);
            } else {
              const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
              const p = 2 * lightness - q;
              newR = Math.round(hue2rgb(p, q, hue + 1/3) * 255);
              newG = Math.round(hue2rgb(p, q, hue) * 255);
              newB = Math.round(hue2rgb(p, q, hue - 1/3) * 255);
            }
          }
          
          data[i] = Math.max(0, Math.min(255, newR));
          data[i + 1] = Math.max(0, Math.min(255, newG));
          data[i + 2] = Math.max(0, Math.min(255, newB));
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
  }, [targetWidth, videoLoaded, isGrayscale, isFlipped, colorCount, reducedColors, hueShift, useHueShift, isInverted, isLuminanceInverted]);

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

  const handleHueShiftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setHueShift(Number(event.target.value));
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

  const startUpdatingHue = (increment: boolean) => {
    const updateValue = () => {
      setHueShift(prev => {
        const newValue = increment ? prev + 5 : prev - 5;
        return Math.min(Math.max(newValue, -180), 180);
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

  const startUpdatingBurstFrames = (increment: boolean) => {
    const updateValue = () => {
      setBurstFrames(prev => {
        const newValue = increment ? prev + 1 : prev - 1;
        return Math.min(Math.max(newValue, 3), 30);
      });
    };

    updateValue();
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

  const captureBurstGif = async () => {
    if (!displayCanvasRef.current || isCapturing) return;
    
    setIsCapturing(true);
    
    try {
      // Create GIF encoder
      const gif = new GIF({
        workers: 2,
        quality: 10,
        width: displayCanvasRef.current.width,
        height: displayCanvasRef.current.height,
        workerScript: '/node_modules/gif.js/dist/gif.worker.js'
      });
      
      // Capture frames
      const capturedFrames: HTMLCanvasElement[] = [];
      const frameDelay = 100; // 100ms between frames
      
      for (let i = 0; i < burstFrames; i++) {
        // Create a copy of the current frame
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = displayCanvasRef.current.width;
        frameCanvas.height = displayCanvasRef.current.height;
        const frameCtx = frameCanvas.getContext('2d');
        
        if (frameCtx) {
          // Apply flip if needed
          if (isFlipped) {
            frameCtx.scale(-1, 1);
            frameCtx.translate(-frameCanvas.width, 0);
          }
          
          frameCtx.imageSmoothingEnabled = false;
          frameCtx.drawImage(displayCanvasRef.current, 0, 0);
          
          // Add frame to GIF
          gif.addFrame(frameCanvas, { delay: frameDelay });
          capturedFrames.push(frameCanvas);
        }
        
        // Wait before next frame
        if (i < burstFrames - 1) {
          await new Promise(resolve => setTimeout(resolve, frameDelay));
        }
      }
      
      // Render GIF
      gif.on('finished', function(blob: Blob) {
        const link = document.createElement('a');
        link.download = `pixelcam-burst-${new Date().toISOString()}.gif`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
        setIsCapturing(false);
      });
      
      gif.render();
      
    } catch (err) {
      console.error('Error creating burst GIF:', err);
      setIsCapturing(false);
    }
  };

  const captureImage = () => {
    if (!displayCanvasRef.current) return;
    
    try {
      const displayCanvas = displayCanvasRef.current;
      const displayCtx = displayCanvas.getContext('2d');
      if (!displayCtx) return;

      // Get the image data to analyze for black bars
      const imageData = displayCtx.getImageData(0, 0, displayCanvas.width, displayCanvas.height);
      const data = imageData.data;
      
      // Function to check if a pixel is black (or very dark)
      const isBlackPixel = (r: number, g: number, b: number) => {
        return r < 10 && g < 10 && b < 10; // Very dark threshold
      };
      
      // Find the actual content bounds by scanning for non-black pixels
      let minX = displayCanvas.width, maxX = 0;
      let minY = displayCanvas.height, maxY = 0;
      
      for (let y = 0; y < displayCanvas.height; y++) {
        for (let x = 0; x < displayCanvas.width; x++) {
          const i = (y * displayCanvas.width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          if (!isBlackPixel(r, g, b)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      
      // If we found content, crop to those bounds, otherwise use full canvas
      const cropX = minX < displayCanvas.width ? minX : 0;
      const cropY = minY < displayCanvas.height ? minY : 0;
      const cropWidth = maxX > 0 ? (maxX - minX + 1) : displayCanvas.width;
      const cropHeight = maxY > 0 ? (maxY - minY + 1) : displayCanvas.height;
      
      // Create final canvas with cropped dimensions
      const finalCanvas = document.createElement('canvas');
      const finalCtx = finalCanvas.getContext('2d');
      if (!finalCtx) return;

      finalCanvas.width = cropWidth;
      finalCanvas.height = cropHeight;

      // Apply flip if needed
      if (isFlipped) {
        finalCtx.scale(-1, 1);
        finalCtx.translate(-finalCanvas.width, 0);
      }

      // Draw only the non-black content area
      finalCtx.imageSmoothingEnabled = false;
      finalCtx.drawImage(
        displayCanvas,
        cropX, cropY, cropWidth, cropHeight,  // Source: cropped area
        0, 0, finalCanvas.width, finalCanvas.height  // Destination: full final canvas
      );

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
                checked={isFlipped}
                onChange={(e) => setIsFlipped(e.target.checked)}
              />
              Flip Horizontal
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
                checked={reducedColors}
                onChange={(e) => setReducedColors(e.target.checked)}
              />
              Use Reduced Colors
            </label>
            <div 
              style={{ 
                opacity: !isGrayscale ? 1 : 0,
                maxHeight: !isGrayscale ? '50px' : '0',
                overflow: 'hidden',
                transition: 'opacity 0.3s ease-in-out, max-height 0.3s ease-in-out',
                pointerEvents: !isGrayscale ? 'auto' : 'none'
              }}
            >
              <label className="effect-control">
                <input
                  type="checkbox"
                  checked={useHueShift}
                  onChange={(e) => setUseHueShift(e.target.checked)}
                />
                Use Hue Shift
              </label>
            </div>
            <label className="effect-control">
              <input
                type="checkbox"
                checked={isLuminanceInverted}
                onChange={(e) => setIsLuminanceInverted(e.target.checked)}
              />
              Invert Luminance
            </label>
            <div 
              style={{ 
                opacity: !isGrayscale ? 1 : 0,
                maxHeight: !isGrayscale ? '50px' : '0',
                overflow: 'hidden',
                transition: 'opacity 0.3s ease-in-out, max-height 0.3s ease-in-out',
                pointerEvents: !isGrayscale ? 'auto' : 'none'
              }}
            >
              <label className="effect-control">
                <input
                  type="checkbox"
                  checked={isInverted}
                  onChange={(e) => setIsInverted(e.target.checked)}
                />
                Invert Colors
              </label>
            </div>
            <label className="effect-control">
              <input
                type="checkbox"
                checked={isBurstMode}
                onChange={(e) => setIsBurstMode(e.target.checked)}
              />
              Burst GIF Mode
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
          <div 
            style={{ 
              opacity: reducedColors ? 1 : 0,
              maxHeight: reducedColors ? '100px' : '0',
              overflow: 'hidden',
              transition: 'opacity 0.3s ease-in-out, max-height 0.3s ease-in-out',
              pointerEvents: reducedColors ? 'auto' : 'none'
            }}
          >
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
          </div>
          <div 
            style={{ 
              opacity: useHueShift ? 1 : 0,
              maxHeight: useHueShift ? '100px' : '0',
              overflow: 'hidden',
              transition: 'opacity 0.3s ease-in-out, max-height 0.3s ease-in-out',
              pointerEvents: useHueShift ? 'auto' : 'none'
            }}
          >
            <div className="resolution-controls">
              <label className="resolution-input">
                Hue Shift:
                <div className="number-control">
                  <button 
                    onMouseDown={() => startUpdatingHue(false)}
                    onTouchStart={() => startUpdatingHue(false)}
                    disabled={hueShift <= -180}
                  >
                    -
                  </button>
                  <span>{hueShift}°</span>
                  <button 
                    onMouseDown={() => startUpdatingHue(true)}
                    onTouchStart={() => startUpdatingHue(true)}
                    disabled={hueShift >= 180}
                  >
                    +
                  </button>
                </div>
              </label>
              <input
                type="range"
                min="-180"
                max="180"
                step="5"
                value={hueShift}
                onChange={handleHueShiftChange}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div 
            style={{ 
              opacity: isBurstMode ? 1 : 0,
              maxHeight: isBurstMode ? '100px' : '0',
              overflow: 'hidden',
              transition: 'opacity 0.3s ease-in-out, max-height 0.3s ease-in-out',
              pointerEvents: isBurstMode ? 'auto' : 'none'
            }}
          >
            <div className="resolution-controls">
              <label className="resolution-input">
                Burst Frames:
                <div className="number-control">
                  <button 
                    onMouseDown={() => startUpdatingBurstFrames(false)}
                    onTouchStart={() => startUpdatingBurstFrames(false)}
                    disabled={burstFrames <= 3}
                  >
                    -
                  </button>
                  <span>{burstFrames}</span>
                  <button 
                    onMouseDown={() => startUpdatingBurstFrames(true)}
                    onTouchStart={() => startUpdatingBurstFrames(true)}
                    disabled={burstFrames >= 30}
                  >
                    +
                  </button>
                </div>
              </label>
              <input
                type="range"
                min="3"
                max="30"
                step="1"
                value={burstFrames}
                onChange={(e) => setBurstFrames(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>
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

      <button 
        onClick={isBurstMode ? captureBurstGif : captureImage} 
        disabled={isCapturing}
        style={{ 
          width: '60px',
          height: '60px',
          position: 'fixed',
          bottom: '30px',
          right: '30px',
          fontSize: '32px',
          padding: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          margin: '0',
          transform: 'none',
          border: 'none',
          borderRadius: '50%',
          backgroundColor: isCapturing ? 'rgba(255, 0, 0, 0.7)' : (isBurstMode ? 'rgba(0, 150, 0, 0.7)' : 'rgba(0, 0, 0, 0.7)'),
          color: 'white',
          cursor: isCapturing ? 'not-allowed' : 'pointer',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
          lineHeight: '1',
          textAlign: 'center',
          opacity: isCapturing ? 0.6 : 1
        }}
      >
        {isCapturing ? '⏳' : (isBurstMode ? '🎬' : '📷')}
      </button>
      </div>
  );
}

export default App
