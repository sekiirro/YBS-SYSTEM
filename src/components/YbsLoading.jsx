import React from 'react';
import muscleLoader from '../../Muscle Animation (Health).svg';

const LOADER_STYLE = {
  width: 'auto',
  height: 'auto',
  maxWidth: 'min(64vw, 340px)',
  maxHeight: '55vh',
};

export default function YbsLoading({ alt = 'Loading…', style = {}, ...props }) {
  return <img src={muscleLoader} alt={alt} style={{ ...LOADER_STYLE, ...style }} {...props} />;
}