// React hooks for component state management and side effects
import { useEffect, useRef, useState } from 'react';
// Modern GIF encoding library - replaced problematic gif.js with more reliable gifenc
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

function App() {
  // =============================================================================
  // STATE MANAGEMENT - All the app's state variables and settings
  // =============================================================================
  
  // UI state for collapsible settings menu
  const [menuOpen, setMenuOpen] = useState(false);
  
  // Canvas and video references - React refs don't trigger re-renders when changed
  const videoRef = useRef<HTMLVideoElement>(null); // Hidden video element that receives camera stream
  const canvasRef = useRef<HTMLCanvasElement>(null); // Hidden processing canvas for effects
  const displayCanvasRef = useRef<HTMLCanvasElement>(null); // Visible canvas that shows final result
  
  // Camera management state
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]); // List of available cameras
  const [selectedCamera, setSelectedCamera] = useState<string>(''); // Currently selected camera ID
  const [videoLoaded, setVideoLoaded] = useState<boolean>(false); // Whether video stream is ready
  
  // Core pixelation setting - determines long edge of final pixelated image
  // Uses lazy initialization to load from localStorage on first render
  const [targetWidth, setTargetWidth] = useState<number>(() => {
    const saved = localStorage.getItem('pixelcam-targetWidth');
    return saved ? JSON.parse(saved) : 150; // Default to 150px on long edge
  });

  // =============================================================================
  // VISUAL EFFECTS STATE - All the different image processing options
  // =============================================================================
  
  // Basic color effects - each loads from localStorage to persist user preferences
  const [isGrayscale, setIsGrayscale] = useState<boolean>(() => {
    const saved = localStorage.getItem('pixelcam-isGrayscale');
    return saved ? JSON.parse(saved) : false;
  });
  
  const [isFlipped, setIsFlipped] = useState<boolean>(() => {
    const saved = localStorage.getItem('pixelcam-isFlipped');
    return saved ? JSON.parse(saved) : false;
  });
  
  // Color quantization - reduces number of colors for more retro look
  const [reducedColors, setReducedColors] = useState<boolean>(() => {
    const saved = localStorage.getItem('pixelcam-reducedColors');
    return saved ? JSON.parse(saved) : false;
  });
  
  const [colorCount, setColorCount] = useState<number>(() => {
    const saved = localStorage.getItem('pixelcam-colorCount');
    return saved ? JSON.parse(saved) : 8; // Default to 8 colors
  });
  
  // Hue shifting - rotates colors around the color wheel
  const [hueShift, setHueShift] = useState<number>(() => {
    const saved = localStorage.getItem('pixelcam-hueShift');
    return saved ? JSON.parse(saved) : 0; // Default to no shift
  });
  
  const [useHueShift, setUseHueShift] = useState<boolean>(() => {
    const saved = localStorage.getItem('pixelcam-useHueShift');
    return saved ? JSON.parse(saved) : false;
  });
  
  // Color inversion effects
  const [isInverted, setIsInverted] = useState<boolean>(() => {
    const saved = localStorage.getItem('pixelcam-isInverted');
    return saved ? JSON.parse(saved) : false;
  });
  
  // Luminance inversion - inverts brightness but preserves hue (more subtle than full inversion)
  const [isLuminanceInverted, setIsLuminanceInverted] = useState<boolean>(() => {
    const saved = localStorage.getItem('pixelcam-isLuminanceInverted');
    return saved ? JSON.parse(saved) : false;
  });
  
  // =============================================================================
  // BURST MODE STATE - For capturing animated GIFs
  // =============================================================================
  
  const [isBurstMode, setIsBurstMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('pixelcam-isBurstMode');
    return saved ? JSON.parse(saved) : false;
  });
  
  const [burstFrames, setBurstFrames] = useState<number>(() => {
    const saved = localStorage.getItem('pixelcam-burstFrames');
    return saved ? JSON.parse(saved) : 10; // Default to 10 frame GIF
  });
  
  const [isCapturing, setIsCapturing] = useState<boolean>(false); // Prevents multiple simultaneous captures
  
  // =============================================================================
  // PERFORMANCE OPTIMIZATION REFS
  // =============================================================================
  
  // Pre-computed lookup table for color quantization - avoids recalculating on every frame
  const colorTableRef = useRef<Uint8Array | undefined>(undefined);
  // Animation frame ID for cleanup - prevents memory leaks
  const animationFrameRef = useRef<number | undefined>(undefined);

  // =============================================================================
  // CAMERA INITIALIZATION - Runs once when component mounts
  // =============================================================================
  
  useEffect(() => {
    // Get list of available cameras and set up initial camera selection
    async function getCameras() {
      try {
        // IMPORTANT: Must request permission first to get camera labels
        // Without this, camera.label will be empty for privacy reasons
        await navigator.mediaDevices.getUserMedia({ video: true })
          .then(stream => {
            // Immediately stop this permission-requesting stream
            // We only needed it to unlock camera labels
            stream.getTracks().forEach(track => track.stop());
          });

        // Now we can get the device list with proper labels
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setCameras(videoDevices);
        
        // Smart camera selection: prefer back camera on mobile, first camera otherwise
        // Mobile devices often have "back" in the camera label
        const backCamera = videoDevices.find(device => device.label.toLowerCase().includes('back'));
        setSelectedCamera(backCamera?.deviceId || videoDevices[0]?.deviceId);
      } catch (err) {
        console.error('Error accessing cameras:', err);
      }
    }

    getCameras();
  }, []); // Empty dependency array = run once on mount

  // =============================================================================
  // CAMERA STREAM MANAGEMENT - Runs when selected camera changes
  // =============================================================================
  
  useEffect(() => {
    // Start camera stream when a camera is selected
    async function startCamera() {
      if (!selectedCamera) return;
      
      try {
        // Clean up any existing stream to prevent resource leaks
        if (videoRef.current?.srcObject) {
          const oldStream = videoRef.current.srcObject as MediaStream;
          oldStream.getTracks().forEach(track => track.stop());
          videoRef.current.srcObject = null;
        }

        // Request the new camera stream with specific constraints
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedCamera }, // Use exact to ensure we get the selected camera
            width: { ideal: 1280 }, // Request high resolution for better quality
            height: { ideal: 720 }  // Will be downscaled for pixelation effect
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

    // Cleanup function - runs when component unmounts or selectedCamera changes
    return () => {
      // Stop camera stream to free up resources
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      // Cancel any pending animation frames to prevent memory leaks
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [selectedCamera]); // Re-run when selectedCamera changes

  // =============================================================================
  // COLOR QUANTIZATION OPTIMIZATION - Pre-compute lookup table
  // =============================================================================
  
  // Update color lookup table when color count or reduced colors setting changes
  useEffect(() => {
    if (!reducedColors) {
      colorTableRef.current = undefined;
      return;
    }

    // Create lookup table for faster color quantization
    // This maps each possible color value (0-255) to a quantized value
    const table = new Uint8Array(256);
    const step = 256 / (colorCount - 1);
    
    for (let i = 0; i < 256; i++) {
      // Round each color value to the nearest quantization level
      // Math.min ensures we don't exceed 255 for bright values
      table[i] = Math.min(255, Math.round(Math.round(i / step) * step));
    }
    
    colorTableRef.current = table;
  }, [colorCount, reducedColors]);

  // =============================================================================
  // SETTINGS PERSISTENCE - Save all settings to localStorage
  // =============================================================================
  
  // Each setting gets its own useEffect to save to localStorage when changed
  // This could be optimized into a custom hook, but kept simple for clarity
  
  useEffect(() => {
    localStorage.setItem('pixelcam-targetWidth', JSON.stringify(targetWidth));
  }, [targetWidth]);

  useEffect(() => {
    localStorage.setItem('pixelcam-isGrayscale', JSON.stringify(isGrayscale));
  }, [isGrayscale]);

  useEffect(() => {
    localStorage.setItem('pixelcam-isFlipped', JSON.stringify(isFlipped));
  }, [isFlipped]);

  useEffect(() => {
    localStorage.setItem('pixelcam-reducedColors', JSON.stringify(reducedColors));
  }, [reducedColors]);

  useEffect(() => {
    localStorage.setItem('pixelcam-colorCount', JSON.stringify(colorCount));
  }, [colorCount]);

  useEffect(() => {
    localStorage.setItem('pixelcam-hueShift', JSON.stringify(hueShift));
  }, [hueShift]);

  useEffect(() => {
    localStorage.setItem('pixelcam-useHueShift', JSON.stringify(useHueShift));
  }, [useHueShift]);

  useEffect(() => {
    localStorage.setItem('pixelcam-isInverted', JSON.stringify(isInverted));
  }, [isInverted]);

  useEffect(() => {
    localStorage.setItem('pixelcam-isLuminanceInverted', JSON.stringify(isLuminanceInverted));
  }, [isLuminanceInverted]);

  useEffect(() => {
    localStorage.setItem('pixelcam-isBurstMode', JSON.stringify(isBurstMode));
  }, [isBurstMode]);

  useEffect(() => {
    localStorage.setItem('pixelcam-burstFrames', JSON.stringify(burstFrames));
  }, [burstFrames]);

  // =============================================================================
  // MAIN FRAME PROCESSING LOOP - The heart of the pixelation effect
  // =============================================================================
  
  useEffect(() => {
    let isActive = true;  // Flag to track if effect is active (prevents race conditions)

    const processFrame = () => {
      // Early exit if component is unmounting or refs aren't ready
      if (!isActive) return;
      
      // Wait for all required elements to be ready
      if (!videoRef.current || !canvasRef.current || !displayCanvasRef.current || 
          !videoRef.current.videoWidth || !videoLoaded) {
        // Keep trying until everything is ready
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      // Get references to all our elements
      const video = videoRef.current;
      const canvas = canvasRef.current; // Processing canvas (hidden)
      const displayCanvas = displayCanvasRef.current; // Display canvas (visible)
      
      // Get 2D contexts with performance optimization for frequent pixel reads
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const displayCtx = displayCanvas.getContext('2d', { willReadFrequently: true });

      if (!ctx || !displayCtx) return;

      // =============================================================================
      // CANVAS SIZING - Calculate dimensions for pixelation and display
      // =============================================================================
      
      // Processing canvas: Small size for pixelation effect
      // Apply targetWidth to the long edge for consistent quality across orientations
      const videoAspectRatio = video.videoWidth / video.videoHeight;
      
      if (video.videoWidth >= video.videoHeight) {
        // Landscape or square - width is the long edge
        canvas.width = targetWidth;
        canvas.height = Math.floor(targetWidth / videoAspectRatio);
      } else {
        // Portrait - height is the long edge
        canvas.height = targetWidth;
        canvas.width = Math.floor(targetWidth * videoAspectRatio);
      }

      // Display canvas: Fits to screen while maintaining aspect ratio
      // This ensures the pixelated image fills the screen properly on all devices
      const screenAspectRatio = window.innerWidth / window.innerHeight;
      
      if (videoAspectRatio > screenAspectRatio) {
        // Video is wider relative to screen, fit to width
        displayCanvas.width = Math.min(window.innerWidth, 1920);
        displayCanvas.height = Math.floor(displayCanvas.width / videoAspectRatio);
      } else {
        // Video is taller relative to screen, fit to height  
        displayCanvas.height = Math.min(window.innerHeight, 1920);
        displayCanvas.width = Math.floor(displayCanvas.height * videoAspectRatio);
      }

      // Clear both canvases for fresh frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      
      // =============================================================================
      // APPLY CSS FILTERS - Fast GPU-accelerated effects
      // =============================================================================
      
      // Build filter string for effects that can be done with CSS filters
      const filters = [];
      if (isGrayscale) {
        filters.push('grayscale(100%)');
      }
      if (useHueShift && hueShift !== 0) {
        filters.push(`hue-rotate(${hueShift}deg)`);
      }
      ctx.filter = filters.length > 0 ? filters.join(' ') : 'none';
      
      // Draw video to processing canvas with downscaling (creates pixelation effect)
      // The small canvas size automatically creates the "pixel" effect
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Reset filter to prevent affecting subsequent operations
      ctx.filter = 'none';
      
      // =============================================================================
      // PIXEL-LEVEL EFFECTS - Custom image processing that requires pixel manipulation
      // =============================================================================
      
      // Color inversion with black pixel preservation
      // This is more complex than CSS invert() because we want to preserve black areas
      if (isInverted) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        if (tempCtx) {
          // Copy current canvas content to temp canvas
          tempCtx.drawImage(canvas, 0, 0);
          
          // Apply invert filter to temp canvas
          tempCtx.filter = 'invert(100%)';
          tempCtx.globalCompositeOperation = 'source-atop';
          tempCtx.drawImage(canvas, 0, 0);
          tempCtx.filter = 'none';
          tempCtx.globalCompositeOperation = 'source-over';
          
          // Get pixel data from both canvases
          const originalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const filteredData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Replace only non-black pixels with inverted versions
          // This preserves black backgrounds/areas
          for (let i = 0; i < originalData.data.length; i += 4) {
            const r = originalData.data[i];
            const g = originalData.data[i + 1];
            const b = originalData.data[i + 2];
            
            // If pixel is not black (with small threshold for noise), use filtered version
            if (r > 5 || g > 5 || b > 5) {
              originalData.data[i] = filteredData.data[i];
              originalData.data[i + 1] = filteredData.data[i + 1];
              originalData.data[i + 2] = filteredData.data[i + 2];
            }
          }
          
          // Put the modified data back to the canvas
          ctx.putImageData(originalData, 0, 0);
        }
      }

      // Color quantization - reduces number of colors for retro effect
      // Uses pre-computed lookup table for performance
      if (reducedColors && colorTableRef.current) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const table = colorTableRef.current;
        
        // Apply lookup table to each color channel
        // ImageData.data is [R, G, B, A, R, G, B, A, ...] format
        for (let i = 0; i < data.length; i += 4) {
          data[i] = table[data[i]];         // Red channel
          data[i + 1] = table[data[i + 1]]; // Green channel
          data[i + 2] = table[data[i + 2]]; // Blue channel
          // Alpha channel (i + 3) is left unchanged
        }
        
        ctx.putImageData(imageData, 0, 0);
      }

      // Luminance inversion - inverts brightness while preserving hue
      // More subtle than full color inversion, creates interesting artistic effects
      if (isLuminanceInverted) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Skip black pixels to preserve black areas
          if (r <= 5 && g <= 5 && b <= 5) {
            continue;
          }
          
          // Convert RGB to HSL (Hue, Saturation, Lightness)
          const max = Math.max(r, g, b) / 255;
          const min = Math.min(r, g, b) / 255;
          const diff = max - min;
          
          // Calculate lightness (brightness)
          let lightness = (max + min) / 2;
          
          // Invert only the lightness component
          lightness = 1 - lightness;
          
          // Convert back to RGB with inverted lightness
          let newR, newG, newB;
          
          if (diff === 0) {
            // Grayscale pixel - just invert lightness
            newR = newG = newB = Math.round(lightness * 255);
          } else {
            // Color pixel - preserve hue and saturation, invert lightness
            
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
            
            // Convert HSL back to RGB with preserved hue/saturation, inverted lightness
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
          
          // Clamp values to valid range and update pixel data
          data[i] = Math.max(0, Math.min(255, newR));
          data[i + 1] = Math.max(0, Math.min(255, newG));
          data[i + 2] = Math.max(0, Math.min(255, newB));
        }
        
        ctx.putImageData(imageData, 0, 0);
      }

      // =============================================================================
      // FINAL DISPLAY - Upscale processed image to display canvas
      // =============================================================================
      
      // Upscale the small processed canvas to the large display canvas
      displayCtx.save();
      displayCtx.imageSmoothingEnabled = false; // Nearest neighbor scaling preserves pixel edges
      displayCtx.drawImage(canvas, 0, 0, displayCanvas.width, displayCanvas.height);
      displayCtx.restore();

      // Schedule next frame if still active
      if (isActive) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
      }
    };

    // Start the processing loop
    processFrame();

    // Cleanup function - runs when component unmounts or dependencies change
    return () => {
      isActive = false;  // Mark effect as inactive to stop processing
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [targetWidth, videoLoaded, isGrayscale, isFlipped, colorCount, reducedColors, hueShift, useHueShift, isInverted, isLuminanceInverted]);

  // =============================================================================
  // EVENT HANDLERS - Simple handlers for form controls
  // =============================================================================
  
  const handleCameraChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCamera(event.target.value);
  };

  const handleTargetWidthChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // Range input values are already constrained by min/max attributes
    setTargetWidth(Number(event.target.value));
  };

  const handleColorCountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setColorCount(Number(event.target.value));
  };

  const handleHueShiftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setHueShift(Number(event.target.value));
  };

  // =============================================================================
  // BUTTON HOLD FUNCTIONALITY - For increment/decrement buttons
  // =============================================================================
  
  // These functions handle the "hold to repeat" functionality for +/- buttons
  // Pattern: immediate update, then delayed repeat, with proper cleanup
  
  const startUpdatingColors = (increment: boolean) => {
    const updateValue = () => {
      setColorCount(prev => {
        const newValue = increment ? prev + 1 : prev - 1;
        return Math.min(Math.max(newValue, 2), 20); // Clamp between 2 and 20
      });
    };

    // First update happens immediately
    updateValue();

    // Then start repeating after a delay
    const timeoutId = setTimeout(() => {
      const intervalId = setInterval(updateValue, 50); // Update every 50ms while holding
      
      // Cleanup function for the interval
      const cleanup = () => {
        clearInterval(intervalId);
        document.removeEventListener('mouseup', cleanup);
        document.removeEventListener('touchend', cleanup);
      };

      // Listen for mouse/touch release to stop repeating
      document.addEventListener('mouseup', cleanup);
      document.addEventListener('touchend', cleanup);
    }, 250); // Start repeating after 250ms hold

    // Cleanup function for the timeout (in case mouse up happens before interval starts)
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
        return Math.min(Math.max(newValue, -180), 180); // Clamp between -180 and 180
      });
    };

    // Same pattern as above - immediate update, then delayed repeat
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

  const startUpdatingBurstFrames = (increment: boolean) => {
    const updateValue = () => {
      setBurstFrames(prev => {
        const newValue = increment ? prev + 1 : prev - 1;
        return Math.min(Math.max(newValue, 3), 30); // Clamp between 3 and 30 frames
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

  const startUpdatingWidth = (increment: boolean) => {
    const updateValue = () => {
      setTargetWidth(prev => {
        const newValue = increment ? prev + 1 : prev - 1;
        return Math.min(Math.max(newValue, 2), 640); // Clamp between 2 and 640 pixels
      });
    };

    // Same pattern as other button hold functions
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

  // =============================================================================
  // BURST GIF CAPTURE - Creates animated GIF from multiple frames
  // =============================================================================
  
  const captureBurstGif = async () => {
    console.log('🎬 Starting burst GIF capture (using gifenc)...');
    
    // Prevent multiple simultaneous captures
    if (!displayCanvasRef.current || isCapturing) {
      console.log('❌ Cannot start capture - missing canvas or already capturing');
      return;
    }
    
    setIsCapturing(true);
    console.log('✅ Set capturing state to true');
    
    try {
      // =============================================================================
      // FRAME CAPTURE PHASE - Capture multiple frames over time with upscaling
      // =============================================================================
      
      // First, analyze the display canvas to find content bounds (same as captureImage)
      const displayCanvas = displayCanvasRef.current;
      const displayCtx = displayCanvas.getContext('2d', { willReadFrequently: true });
      if (!displayCtx) return;

      // Get pixel data to analyze for black bars
      const analysisImageData = displayCtx.getImageData(0, 0, displayCanvas.width, displayCanvas.height);
      const analysisData = analysisImageData.data;
      
      // Helper function to identify black/empty pixels
      const isBlackPixel = (r: number, g: number, b: number) => {
        return r < 10 && g < 10 && b < 10;
      };
      
      // Find content bounds by scanning for non-black pixels
      let minX = displayCanvas.width, maxX = 0;
      let minY = displayCanvas.height, maxY = 0;
      
      for (let y = 0; y < displayCanvas.height; y++) {
        for (let x = 0; x < displayCanvas.width; x++) {
          const i = (y * displayCanvas.width + x) * 4;
          const r = analysisData[i];
          const g = analysisData[i + 1];
          const b = analysisData[i + 2];
          
          if (!isBlackPixel(r, g, b)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      
      // Calculate crop dimensions
      const cropX = minX < displayCanvas.width ? minX : 0;
      const cropY = minY < displayCanvas.height ? minY : 0;
      const cropWidth = maxX > 0 ? (maxX - minX + 1) : displayCanvas.width;
      const cropHeight = maxY > 0 ? (maxY - minY + 1) : displayCanvas.height;
      
      // Calculate upscaled dimensions - long edge should be 1920px
      const cropAspectRatio = cropWidth / cropHeight;
      let finalWidth, finalHeight;
      
      if (cropWidth >= cropHeight) {
        // Landscape or square - width is the long edge
        finalWidth = 1920;
        finalHeight = Math.round(1920 / cropAspectRatio);
      } else {
        // Portrait - height is the long edge
        finalHeight = 1920;
        finalWidth = Math.round(1920 * cropAspectRatio);
      }
      
      console.log(`📹 Starting to capture ${burstFrames} frames...`);
      console.log(`📐 Crop dimensions: ${cropWidth}x${cropHeight}`);
      console.log(`📐 Final GIF dimensions: ${finalWidth}x${finalHeight}`);
      
      const frames: ImageData[] = [];
      const frameDelay = 100; // 100ms between frames (10 FPS)
      
      // Capture each frame with proper cropping and upscaling
      for (let i = 0; i < burstFrames; i++) {
        console.log(`📸 Capturing frame ${i + 1}/${burstFrames}...`);
        
        // Create final canvas with upscaled dimensions
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = finalWidth;
        frameCanvas.height = finalHeight;
        const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });
        
        if (frameCtx) {
          // Apply horizontal flip if enabled
          if (isFlipped) {
            frameCtx.scale(-1, 1);
            frameCtx.translate(-frameCanvas.width, 0);
          }
          
          // Draw cropped and upscaled content
          frameCtx.imageSmoothingEnabled = false; // Preserve pixel edges
          frameCtx.drawImage(
            displayCanvas,
            cropX, cropY, cropWidth, cropHeight,  // Source: cropped area
            0, 0, finalWidth, finalHeight  // Destination: upscaled final canvas
          );
          
          // Extract pixel data for GIF encoding
          const imageData = frameCtx.getImageData(0, 0, finalWidth, finalHeight);
          frames.push(imageData);
          console.log(`✅ Frame ${i + 1} captured and upscaled`);
        }
        
        // Wait before capturing next frame (except for last frame)
        if (i < burstFrames - 1) {
          await new Promise(resolve => setTimeout(resolve, frameDelay));
        }
      }
      
      // =============================================================================
      // GIF ENCODING PHASE - Convert frames to animated GIF
      // =============================================================================
      
      console.log('🎞️ All frames captured, creating GIF with gifenc...');
      
      // Create GIF encoder instance
      const gif = GIFEncoder();
      
      // Process each captured frame
      for (let i = 0; i < frames.length; i++) {
        console.log(`🎨 Processing frame ${i + 1}/${frames.length}...`);
        
        const imageData = frames[i];
        
        // Quantize colors - GIF format supports max 256 colors
        // This reduces the color palette while trying to preserve image quality
        const palette = quantize(imageData.data, 256);
        const index = applyPalette(imageData.data, palette);
        
        // Add frame to GIF with timing information using upscaled dimensions
        gif.writeFrame(index, finalWidth, finalHeight, {
          palette,
          delay: frameDelay / 10, // gifenc expects delay in centiseconds (1/100s)
        });
        
        console.log(`✅ Frame ${i + 1} processed`);
      }
      
      // Finalize GIF encoding
      console.log('🏁 Finalizing GIF...');
      gif.finish();
      
      // =============================================================================
      // DOWNLOAD PHASE - Create blob and trigger download
      // =============================================================================
      
      // Get the final GIF data as bytes
      const gifBytes = gif.bytes();
      console.log(`🎉 GIF created! Size: ${gifBytes.length} bytes`);
      
      // Create blob and download link
      const blob = new Blob([gifBytes], { type: 'image/gif' });
      const link = document.createElement('a');
      link.download = `pixelcam-burst-${new Date().toISOString()}.gif`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href); // Clean up object URL
      
      console.log('💾 GIF downloaded successfully');
      setIsCapturing(false);
      console.log('✅ Capture state reset');
      
    } catch (err) {
      console.error('💥 Error creating burst GIF:', err);
      setIsCapturing(false);
    }
  };

  // =============================================================================
  // SINGLE IMAGE CAPTURE - Captures and downloads a single PNG
  // =============================================================================
  
  const captureImage = () => {
    if (!displayCanvasRef.current) return;
    
    try {
      const displayCanvas = displayCanvasRef.current;
      const displayCtx = displayCanvas.getContext('2d', { willReadFrequently: true });
      if (!displayCtx) return;

      // =============================================================================
      // BLACK BAR DETECTION - Find actual image content bounds
      // =============================================================================
      
      // Get all pixel data to analyze
      const imageData = displayCtx.getImageData(0, 0, displayCanvas.width, displayCanvas.height);
      const data = imageData.data;
      
      // Helper function to identify black/empty pixels
      const isBlackPixel = (r: number, g: number, b: number) => {
        return r < 10 && g < 10 && b < 10; // Very dark threshold
      };
      
      // Scan entire image to find content bounds
      // This removes black bars that might appear due to aspect ratio differences
      let minX = displayCanvas.width, maxX = 0;
      let minY = displayCanvas.height, maxY = 0;
      
      for (let y = 0; y < displayCanvas.height; y++) {
        for (let x = 0; x < displayCanvas.width; x++) {
          const i = (y * displayCanvas.width + x) * 4; // RGBA pixel index
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // If pixel has content (not black), update bounds
          if (!isBlackPixel(r, g, b)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      
      // Calculate crop dimensions (fallback to full canvas if no content found)
      const cropX = minX < displayCanvas.width ? minX : 0;
      const cropY = minY < displayCanvas.height ? minY : 0;
      const cropWidth = maxX > 0 ? (maxX - minX + 1) : displayCanvas.width;
      const cropHeight = maxY > 0 ? (maxY - minY + 1) : displayCanvas.height;
      
      // =============================================================================
      // FINAL IMAGE CREATION - Create upscaled final image (1920px on long edge)
      // =============================================================================
      
      // Calculate upscaled dimensions - long edge should be 1920px
      const cropAspectRatio = cropWidth / cropHeight;
      let finalWidth, finalHeight;
      
      if (cropWidth >= cropHeight) {
        // Landscape or square - width is the long edge
        finalWidth = 1920;
        finalHeight = Math.round(1920 / cropAspectRatio);
      } else {
        // Portrait - height is the long edge
        finalHeight = 1920;
        finalWidth = Math.round(1920 * cropAspectRatio);
      }
      
      // Create final canvas with upscaled dimensions
      const finalCanvas = document.createElement('canvas');
      const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
      if (!finalCtx) return;

      finalCanvas.width = finalWidth;
      finalCanvas.height = finalHeight;

      // Apply horizontal flip if enabled
      if (isFlipped) {
        finalCtx.scale(-1, 1);
        finalCtx.translate(-finalCanvas.width, 0);
      }

      // Draw cropped content upscaled to final canvas
      finalCtx.imageSmoothingEnabled = false; // Preserve pixel edges for crisp upscaling
      finalCtx.drawImage(
        displayCanvas,
        cropX, cropY, cropWidth, cropHeight,  // Source: cropped area from display canvas
        0, 0, finalWidth, finalHeight  // Destination: upscaled final canvas
      );

      // Create and trigger download
      const link = document.createElement('a');
      link.download = `pixelcam-${new Date().toISOString()}.png`;
      link.href = finalCanvas.toDataURL('image/png');
      link.click();
      
    } catch (err) {
      console.error('Error saving image:', err);
    }
  };

  // =============================================================================
  // RENDER - The component's JSX structure
  // =============================================================================
  
  return (
    <div className="app">
      {/* =============================================================================
          SETTINGS MENU - Collapsible settings panel
          ============================================================================= */}
      
      <button 
        className="menu-toggle"
        onClick={() => setMenuOpen(prev => !prev)}
      >
        {menuOpen ? '▼ Settings' : '▲ Settings'}
      </button>

      <div className={`camera-controls ${menuOpen ? 'open' : ''}`}>
        {/* Camera selection dropdown */}
        <select value={selectedCamera} onChange={handleCameraChange}>
          {cameras.map(camera => (
            <option key={camera.deviceId} value={camera.deviceId}>
              {camera.label || `Camera ${camera.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
        
        <div className="pixel-control">
          {/* =============================================================================
              EFFECT CONTROLS - Checkboxes for various visual effects
              ============================================================================= */}
          
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
              Quantize Color Channels
            </label>
            
            {/* Hue shift control - hidden when grayscale is enabled */}
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
            
            {/* Color inversion control - hidden when grayscale is enabled */}
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
          
          {/* =============================================================================
              RESOLUTION CONTROLS - Main pixelation setting
              ============================================================================= */}
          
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
              long edge
            </label>
            {/* Range slider for resolution */}
            <input
              type="range"
              min="2"
              max="640"
              value={targetWidth}
              onChange={handleTargetWidthChange}
              style={{ width: '100%' }}
            />
          </div>
          
          {/* =============================================================================
              COLOR COUNT CONTROLS - Shown only when reduced colors is enabled
              ============================================================================= */}
          
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
                Levels Per Color Channel:
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
          
          {/* =============================================================================
              HUE SHIFT CONTROLS - Shown only when hue shift is enabled and not grayscale
              ============================================================================= */}
          
          <div 
            style={{ 
              opacity: useHueShift && !isGrayscale ? 1 : 0,
              maxHeight: useHueShift && !isGrayscale ? '100px' : '0',
              overflow: 'hidden',
              transition: 'opacity 0.3s ease-in-out, max-height 0.3s ease-in-out',
              pointerEvents: useHueShift && !isGrayscale ? 'auto' : 'none'
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
          
          {/* =============================================================================
              BURST FRAME CONTROLS - Shown only when burst mode is enabled
              ============================================================================= */}
          
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

      {/* =============================================================================
          CAMERA DISPLAY - The main video and canvas elements
          ============================================================================= */}
      
      <div className="camera-container">
        {/* Hidden video element that receives the camera stream */}
        <video 
          ref={videoRef}
          autoPlay 
          playsInline // Required for iOS to prevent fullscreen
          muted // Required for autoplay in most browsers
          onLoadedData={() => setVideoLoaded(true)}
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: 0,
            pointerEvents: 'none'
          }}
        />
        
        {/* Hidden processing canvas - where effects are applied */}
        <canvas 
          ref={canvasRef}
          style={{ display: 'none' }}
        />
        
        {/* Visible display canvas - shows the final pixelated result */}
        <canvas
          ref={displayCanvasRef}
          className="display-canvas"
          style={{
            // CSS transform for flip effect (applied in addition to canvas-based flip for captures)
            transform: isFlipped ? 'scaleX(-1)' : 'none',
            transition: 'transform 0.2s'
          }}
        />
      </div>

      {/* =============================================================================
          CAPTURE BUTTON - Main action button for taking photos/GIFs
          ============================================================================= */}
      
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
          // Dynamic background color based on mode and state
          backgroundColor: isCapturing ? 'rgba(255, 0, 0, 0.7)' : (isBurstMode ? 'rgba(0, 150, 0, 0.7)' : 'rgba(0, 0, 0, 0.7)'),
          color: 'white',
          cursor: isCapturing ? 'not-allowed' : 'pointer',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
          lineHeight: '1',
          textAlign: 'center',
          opacity: isCapturing ? 0.6 : 1
        }}
      >
        {/* Dynamic icon based on current state */}
        {isCapturing ? '⏳' : (isBurstMode ? '🎬' : '📷')}
      </button>
    </div>
  );
}

export default App