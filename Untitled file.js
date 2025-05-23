import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Button, Platform } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';

export default function App() {
  const [location, setLocation] = useState(null);
  const [watcher, setWatcher] = useState(null);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission to access location was denied');
        return;
      }

      let current = await Location.getCurrentPositionAsync({});
      setLocation(current.coords);
    })();
  }, []);

  const startTracking = async () => {
    if (tracking) {
      watcher?.remove();
      setWatcher(null);
      setTracking(false);
    } else {
      const newWatcher = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 5,
        },
        (loc) => {
          console.log('Tracked:', loc.coords);
          setLocation(loc.coords);
        }
      );
      setWatcher(newWatcher);
      setTracking(true);
    }
  };

  return (
    <View style={styles.container}>
      {location && (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation
        >
          <Marker coordinate={location} />
        </MapView>
      )}
      <View style={styles.buttonContainer}>
        <Button
          title={tracking ? 'Stop Tracking' : 'Start Tracking'}
          onPress={startTracking}
        />
      </View>
    </View>
  );
}

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