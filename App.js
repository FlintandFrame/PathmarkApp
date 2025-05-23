// Import persistent storage for saving path history
import AsyncStorage from '@react-native-async-storage/async-storage';
//test
// Import map polyline drawing tool
import { Polyline } from 'react-native-maps';

import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Button, Platform } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { Text } from 'react-native';
import { ScrollView, TextInput } from 'react-native';
import { TouchableOpacity } from 'react-native';

// Unique ID generator for new paths
const generateId = () => Date.now().toString() + Math.random().toString(36).substr(2, 5);

// Calculates distance in miles between two lat/lng points using the Haversine formula
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in miles
};

export default function App() {
  // State for current GPS position
  const [location, setLocation] = useState(null);

  // Reference to the active location watcher (so we can stop it later)
  const [watcher, setWatcher] = useState(null);

  // Toggle tracking state (active or not)
  const [tracking, setTracking] = useState(false);

  // Array of all saved paths (each path = array of points)
  const [paths, setPaths] = useState([]);

  // Modal state for renaming paths
  const [renameModalVisible, setRenameModalVisible] = useState(false); // whether the rename modal is open
  const [renamingIndex, setRenamingIndex] = useState(null); // index of the path being renamed
  const [newName, setNewName] = useState(''); // new name input value
  const [newNote, setNewNote] = useState('');

  // Ref to control the MapView (for zooming to selected paths)
  const mapRef = useRef(null);

  // Tracks which path should be shown exclusively (null = show all)
  const [visiblePathIndex, setVisiblePathIndex] = useState(null);

  // Add pin state
  const [pins, setPins] = useState([]);

  // Controls visibility of the pin details modal
  const [pinModalVisible, setPinModalVisible] = useState(false);

  // Tracks which pin is being edited in the modal
  const [activePinIndex, setActivePinIndex] = useState(null);

  // User input fields for the pin modal
  const [pinNameInput, setPinNameInput] = useState('');
  const [pinCategoryInput, setPinCategoryInput] = useState('');
  const [pinNotesInput, setPinNotesInput] = useState('');

  // user input field timeout modal
  const pinModalTimeout = useRef(null);

  // State variable for saved categories
  const [categories, setCategories] = useState([]);

  // Pause resume state variables
  const [paused, setPaused] = useState(false);

  // State variables for category list
  const [showCategoryList, setShowCategoryList] = useState(false);

  // Load location and stored paths when app starts
  useEffect(() => {
    (async () => {
      // Request location permissions from user
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access location was denied');
        return;
      }

      // Get initial position to center the map
      let current = await Location.getCurrentPositionAsync({});
      setLocation(current.coords);

      // Load previously saved paths from local storage
      try {
        // Attempt to load saved path data from AsyncStorage
        const stored = await AsyncStorage.getItem('@paths');

        if (stored) {
          // Try to parse the JSON string into a JS object
          const parsed = JSON.parse(stored);

          // Basic validation: ensure it's an array and each item has a valid 'points' array
          if (Array.isArray(parsed) && parsed.every(p => Array.isArray(p.points))) {
            setPaths(parsed);

          } else {
            console.warn('Stored path data was invalid — resetting');

            // If data structure is corrupted or unexpected, reset everything
            setPaths([]);
            await AsyncStorage.removeItem('@paths');
          }
        } else {
          // If nothing stored yet, start fresh
          setPaths([]);
        }
      } catch (err) {
        // If JSON.parse fails or any other issue occurs
        console.error('Failed to load stored paths:', err);
        setPaths([]);
      }

      // Load saved pins
      try {
        const savedPins = await AsyncStorage.getItem('@pins');
        if (savedPins) {
          try {
            setPins(JSON.parse(savedPins));
          } catch (e) {
            console.warn('Invalid pin data, clearing');
            await AsyncStorage.removeItem('@pins');
            setPins([]);
          }
        }
      } catch (pinLoadErr) {
        console.error('Failed to load pins:', pinLoadErr);
      }

      // Load saved categories
      try {
        const storedCategories = await AsyncStorage.getItem('@categories');
        if (storedCategories) {
          try {
            setCategories(JSON.parse(storedCategories));
          } catch (e) {
            console.warn('Failed to load categories');
            await AsyncStorage.removeItem('@categories');
            setCategories([]);
          }
        }
      } catch (e) {
        console.error('Failed to load categories:', e);
      }
    })();
  }, []);

  // Toggle start/stop tracking
  const startTracking = async () => {
    if (tracking && !paused) {
      // Pause tracking
      watcher?.remove();
      setWatcher(null);
      setPaused(true);
      return;
    }

    if (tracking && paused) {
      // Resume tracking
      const resumedWatcher = await Location.watchPositionAsync( 
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 1,
        },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          setLocation({ latitude, longitude });

          setPaths((prev) => {
            const lastPath = prev[prev.length - 1];
            const points = [...lastPath.points, { latitude, longitude }];

            let additionalDistance = 0;
            if (lastPath.points.length > 0) {
              const lastPoint = lastPath.points[lastPath.points.length - 1];
              additionalDistance = getDistance(
                lastPoint.latitude,
                lastPoint.longitude,
                latitude,
                longitude
              );
            }

            const updatedPath = {
              ...lastPath,
              points,
              distance: lastPath.distance + additionalDistance,
            };

            const updated = [...prev.slice(0, -1), updatedPath];
            savePathsToStorage(updated);
            return updated;
          });
        }
      );

      setWatcher(resumedWatcher);
      setPaused(false);
      return;
    }

    // Start fresh tracking
    setPaths(prev => {
      const newPath = {
        id: generateId(),
        name: `Path ${prev.length + 1}`,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        distance: 0,
        points: [],
        note: true,
        visible: true,
      };
      const updated = [...prev, newPath];
      savePathsToStorage(updated);
      return updated;
    });

    const newWatcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 1,
      },
      (loc) => {
        const { latitude, longitude } = loc.coords;
        setLocation({ latitude, longitude });

        setPaths((prev) => {
          const lastPath = prev[prev.length - 1];
          const points = [...lastPath.points, { latitude, longitude }];

          let additionalDistance = 0;
          if (lastPath.points.length > 0) {
            const lastPoint = lastPath.points[lastPath.points.length - 1];
            additionalDistance = getDistance(
              lastPoint.latitude,
              lastPoint.longitude,
              latitude,
              longitude
            );
          }

          const updatedPath = {
            ...lastPath,
            points,
            distance: lastPath.distance + additionalDistance,
          };

          const updated = [...prev.slice(0, -1), updatedPath];
          savePathsToStorage(updated);
          return updated;
        });
      }
    );

    setWatcher(newWatcher);
    setTracking(true);
    setPaused(false);
  };

  // Save the full paths array to local device storage
  const savePathsToStorage = async (updatedPaths) => {
    try {
      const previous = await AsyncStorage.getItem('@paths');
      const previousParsed = previous ? JSON.parse(previous) : [];

      // Check for changes (stringify for deep comparison)
      if (JSON.stringify(previousParsed) !== JSON.stringify(updatedPaths)) {
        await AsyncStorage.setItem('@paths', JSON.stringify(updatedPaths));
      }
    } catch (error) {
      console.log('Error saving paths:', error);
    }
  };

  const deletePath = (indexToDelete) => {
    const updated = paths.filter((_, i) => i !== indexToDelete);
    setPaths(updated);
    savePathsToStorage(updated);
  };

  const toggleVisibility = (index) => {
    const updated = [...paths];
    updated[index].visible = !updated[index].visible;
    setPaths(updated);
    savePathsToStorage(updated);
  };

  // Clear all pins from state and storage
  const clearPins = async () => {
    setPins([]);
    await AsyncStorage.removeItem('@pins');
  };

  // Clear all categories from state and storage
  const clearCategories = async () => {
    setCategories([]);
    await AsyncStorage.removeItem('@categories');
  };

  // Drop a pin with default metadata, then prompt user to name/categorize it
  const dropPin = async () => {
    if (!location) return;

    // Create a default pin object
    const newPin = {
      id: Date.now().toString(),
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: new Date().toISOString(),
      name: '',
      category: '',
      notes: '',
      photos: [],
      detailsPending: true, // stays true until user saves details
    };

    // Add the new pin to the current list
    const updated = [...pins, newPin];
    setPins(updated);
    await AsyncStorage.setItem('@pins', JSON.stringify(updated));

    // Show the modal for editing details of the new pin
    setActivePinIndex(updated.length - 1); // last pin in array
    setPinModalVisible(true);
    setPinNameInput('');
    setPinCategoryInput('');
    setPinNotesInput('');

    // Clear any previous timeout before starting a new one
    if (pinModalTimeout.current) {
      clearTimeout(pinModalTimeout.current);
    }

    // Set an initial 10-second timeout — will auto-dismiss if user doesn’t interact
    pinModalTimeout.current = setTimeout(() => {
      setPinModalVisible(false);
      setActivePinIndex(null);
      pinModalTimeout.current = null;
    }, 10000); // 10 seconds
  };

  // Refreshes the pin modal timeout to 30 seconds after user interaction
  const extendPinModalTimeout = () => {
    if (pinModalTimeout.current) {
      clearTimeout(pinModalTimeout.current);
    }

    pinModalTimeout.current = setTimeout(() => {
      setPinModalVisible(false);
      setActivePinIndex(null);
      pinModalTimeout.current = null;
    }, 30000); // 30 seconds after last interaction
  };

  // Zoom the map to show the full bounds of the selected path
  const zoomToPath = (points) => {
    if (!mapRef.current || points.length < 2) return;

    // Animate and fit map to the full route
    mapRef.current.fitToCoordinates(points, {
      edgePadding: {
        top: 50,
        right: 50,
        bottom: 50,
        left: 50,
      },
      animated: true,
    });
  };

  const showAllPaths = () => {
    const updated = paths.map(p => ({ ...p, visible: true }));
    setPaths(updated);
    savePathsToStorage(updated);
  };

  return (
    <View style={styles.container}>
      {location && (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation
        >
          {/* Display current location marker */}
          <Marker coordinate={location} />

          {/* Display all dropped pins */}
          {pins.map(pin => (
            <Marker
              key={pin.id}
              coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
              title={`Pin @ ${new Date(pin.timestamp).toLocaleTimeString()}`}
              pinColor="orange"
            />
          ))}

          {/* Draw each saved path as a polyline */}
          {paths.map((segment, index) => {
            if (!segment || ! Array.isArray(segment.points))
              return null;

            // If a path is selected, only show that one
            if (visiblePathIndex !== null && visiblePathIndex !== index) return null;
            
            return (
              <Polyline
                key={index}
                coordinates={segment.points}
                strokeColor="#0a84ff"
                strokeWidth={4}
              />
            );
          })}
        </MapView>
      )}

      {/* Display saved paths list below the map */}
      <ScrollView style={{ maxHeight: 160 }} contentContainerStyle={{ padding: 10 }}>
        {paths.map((segment, index) => (
          <View
            key={index}
            style={{
              marginBottom: 10,
              borderBottomWidth: 1,
              borderBottomColor: '#ccc',
              backgroundColor: visiblePathIndex === index ? '#eef6ff' : '#fff',
              padding: 10,
              borderRadius: 5,
            }}
          >
            {/* Tappable header to toggle single path view */}
            <TouchableOpacity
              onPress={() => {
                if (visiblePathIndex === index) {
                  setVisiblePathIndex(null); // Show all
                } else {
                  setVisiblePathIndex(index); // Show only this
                  zoomToPath(segment.points);
                }
              }}
            >
              <Text style={{ fontWeight: 'bold', fontSize: 16 }}>
                {segment.name || `Path ${index + 1}`}
              </Text>
              <Text style={{ color: 'gray', fontSize: 12 }}>
                {new Date(segment.startedAt).toLocaleString()}
              </Text>
              <Text style={{ color: '#555', fontSize: 12 }}>
                Points tracked: {segment.points.length}
              </Text>
              {/* Distance of the path in miles */}
              <Text style={{ color: '#555', fontSize: 12 }}>
                Distance: {(segment.distance || 0).toFixed(2)} miles
              </Text>
              {segment.note ? (
                <Text style={{ fontStyle: 'italic', color: '#444', fontSize: 12 }}>
                  Note: {segment.note}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Control buttons */}
            <Button
              title="Edit"
              onPress={() => {
                setRenamingIndex(index);
                setNewName(segment.name);
                setNewNote(segment.note || '');
                setRenameModalVisible(true);
              }}
            />
            <Button
              title="Delete"
              color="tomato"
              onPress={() => deletePath(index)}
            />
          </View>
        ))}

        {/* Show All Paths button */}
        {visiblePathIndex !== null && (
          <View style={{ marginTop: 10 }}>
            <Button
              title="Show All Paths"
              onPress={() => setVisiblePathIndex(null)}
              color="#444"
            />
          </View>
        )}
      </ScrollView>

      {/* Rename Modal (shows when renameModalVisible is true) */}
      {renameModalVisible && (
        <View
          style={{
            position: 'absolute',
            top: '30%',
            left: '10%',
            right: '10%',
            backgroundColor: 'white',
            padding: 20,
            borderRadius: 10,
            elevation: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
          }}>
          <Text style={{ fontWeight: 'bold', marginBottom: 10 }}>Edit Path Details</Text>
          {/* Rename input */}
          <TextInput
            placeholder="Enter name"
            value={newName}
            onChangeText={setNewName}
            style={{ borderBottomWidth: 1, marginBottom: 20 }}
          />

          {/* Note input */}
          <TextInput
            placeholder="Add a note or tag"
            value={newNote}
            onChangeText={setNewNote}
            style={{ borderBottomWidth: 1, marginBottom: 20 }}
          />

          <Button
            title="Save"
            onPress={() => {
              const updated = [...paths];
              updated[renamingIndex].name = newName;
              updated[renamingIndex].note = newNote;
              setPaths(updated);
              savePathsToStorage(updated);
              setRenameModalVisible(false);
              setRenamingIndex(null);
              setNewName('');
              setNewNote('');
            }}
          />

          <Button
            title="Cancel"
            color="gray"
            onPress={() => {
              setRenameModalVisible(false);
              setRenamingIndex(null);
              setNewName('');
              setNewNote('');
            }}
          />
        </View>
      )}

      {/* Modal for editing new pin details */}
      {pinModalVisible && activePinIndex !== null && (
        <View
          style={{
            position: 'absolute',
            top: '25%',
            left: '10%',
            right: '10%',
            backgroundColor: 'white',
            padding: 20,
            borderRadius: 10,
            elevation: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
          }}
        >
          <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 10 }}>
            Add Pin Details
          </Text>

          {/* Name input */}
          <TextInput
            placeholder="Name this location"
            value={pinNameInput}
            onChangeText={(text) => {
              setPinNameInput(text);
              extendPinModalTimeout(); // Reset timeout to 30 seconds if user types
            }}
            style={{ borderBottomWidth: 1, marginBottom: 10 }}
          />

          {/* Category input */}
          <TextInput
            placeholder="Category"
            value={pinCategoryInput}
            onChangeText={(text) => {
              setPinCategoryInput(text);
              extendPinModalTimeout(); // Reset timeout to 30 seconds if user types
            }}
            style={{ borderBottomWidth: 1, marginBottom: 10 }}
          />

          {categories.length > 0 && (
            <View style={{ marginBottom: 10 }}>
              <Text style={{ marginBottom: 5 }}>Choose category:</Text>
              <TouchableOpacity
                style={{
                  borderWidth: 1,
                  borderColor: '#ccc',
                  padding: 8,
                  borderRadius: 4,
                }}
                onPress={() => setShowCategoryList(!showCategoryList)}
              >
                <Text>{pinCategoryInput || 'Select a category'}</Text>
              </TouchableOpacity>

              {showCategoryList && categories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => {
                    setPinCategoryInput(cat);
                    setShowCategoryList(false);
                    extendPinModalTimeout();
                  }}
                  style={{
                    padding: 8,
                    borderBottomWidth: 1,
                    borderColor: '#eee',
                  }}
                >
                  <Text>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}


          {/* Notes input */}
          <TextInput
            placeholder="Notes"
            value={pinNotesInput}
            onChangeText={(text) => {
              setPinNotesInput(text);
              extendPinModalTimeout(); // Reset timeout to 30 seconds if user types
            }}
            multiline
            style={{ borderBottomWidth: 1, marginBottom: 20 }}
          />

          {/* Save Button */}
          <Button
            title="Save"
            onPress={async() => {
              if (pinModalTimeout.current) {
                clearTimeout(pinModalTimeout.current);
                pinModalTimeout.current = null;
              }

              const updated = [...pins];
              const pin = updated[activePinIndex];

              // Update pin details
              updated[activePinIndex] = {
                ...pin,
                name: pinNameInput,
                category: pinCategoryInput,
                notes: pinNotesInput,
                detailsPending: false, // user completed this pin
              };

              setPins(updated);
              AsyncStorage.setItem('@pins', JSON.stringify(updated));

              // Update category list if new category isn't already saved
              if (pinCategoryInput && !categories.includes(pinCategoryInput)) {
                const updatedCategories = [...categories, pinCategoryInput];
                setCategories(updatedCategories);
                await AsyncStorage.setItem('@categories', JSON.stringify(updatedCategories));
              }

              setPinModalVisible(false);
              setActivePinIndex(null);
            }}
          />

          {/* Skip Button */}
          <Button
            title="Skip for Now"
            color="gray"
            onPress={() => {
              if (pinModalTimeout.current) {
                clearTimeout(pinModalTimeout.current);
                pinModalTimeout.current = null;
              }

              setPinModalVisible(false);
              setActivePinIndex(null);
            }}
          />
        </View>
      )}

      {/* Floating UI buttons */}
      <View style={styles.buttonContainer}>
        <Button
          title={
            tracking
              ? paused
                ? 'Resume Tracking'
                : 'Pause Tracking'
              : 'Start Tracking'
          }
          onPress={startTracking}
        />

        {tracking && (
          <Button
            title="Stop Tracking"
            color="tomato"
            onPress={async () => {
              watcher?.remove();
              setWatcher(null);
              setTracking(false);
              setPaused(false);

              // Finalize the last path
              setPaths(prev => {
                const lastPath = prev[prev.length - 1];
                const updatedPath = {
                  ...lastPath,
                  stoppedAt: new Date().toISOString()
                };
                const updated = [...prev.slice(0, -1), updatedPath];
                savePathsToStorage(updated);
                return updated;
              });
            }}
          />
        )}
        <Button
          title="Clear Path"
          color="tomato"
          onPress={async () => {
            await AsyncStorage.removeItem('@paths');
            setPaths([]);
          }}
        />
        <Button
          title="Drop Pin"
          onPress={dropPin}
          color="#007AFF"
        />
        <Button
          title="Clear Pins"
          color="orange"
          onPress={clearPins}
        />
        <Button
          title="Clear Cat"
          color="purple"
          onPress={clearCategories}
        />
      </View>
    </View>
  );
}

// Basic layout styling
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 40,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
  },
});
