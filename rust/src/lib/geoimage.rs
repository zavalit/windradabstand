
#[path = "geometry.rs"]
mod geometry;



pub mod geoimage {
	use serde::{Serialize, Deserialize};
	use std::{path::Path, fs::File};
	use std::io::Write;
	use image;
	use crate::geometry::geometry::Point;

	const PI:f64 = std::f64::consts::PI;


	#[derive(Serialize, Deserialize, PartialEq, Debug)]
	pub struct GeoImage {
		size: usize,
		zoom: usize,
		x_offset: usize,
		y_offset: usize,
		x0: f64,
		y0: f64,
		pixel_scale: f64,
		data: Vec<f64>,
	}

	impl GeoImage {
		pub fn new(size:usize, zoom:usize, x_offset:usize, y_offset:usize) -> GeoImage {
			let scale = (2.0_f64).powf(zoom as f64);
			//println!("Image::new {} {}", zoom, scale);
			let length:usize = (size*size).try_into().unwrap();
			//println!("size:{} length:{}", size, length);

			let mut image = GeoImage{
				size,
				zoom,
				x_offset,
				y_offset,
				x0: (x_offset as f64)/scale,
				y0: (y_offset as f64)/scale,
				pixel_scale: 1.0/(size as f64)/scale,
				data: Vec::with_capacity(length),
			};
			image.data.resize(length, f64::MAX);

			return image;
		}
		pub fn get_pixel_as_point(&self, x:usize, y:usize) -> Point {
			//println!("get_pixel_as_point {} {} {} {} {} {}", x, y, self.x_offset, self.y_offset, self.scale, self.size);

			return Point::new(
				demercator_x((x as f64)*self.pixel_scale + self.x0),
				demercator_y((y as f64)*self.pixel_scale + self.y0),
			)
		}
		pub fn set_pixel_value(&mut self, x:usize, y:usize, distance:f64) {
			if x >= self.size { panic!(); }
			if y >= self.size { panic!(); }
			self.data[x + y*self.size] = distance;
		}
		pub fn export(&self, filename:&Path) {
			let size = self.size as u32;
			let img = image::RgbImage::from_fn(size, size, |x,y| {
				let d = self.data[(x + y*size) as usize];
				let v = d.min(2000.0) as u32;
				let r = (v & 255u32) as u8;
				let g = 16*((v >> 8) & 255u32) as u8;
				image::Rgb([r, g, 0u8])
			});
			let _result = img.save(filename);
		}
		pub fn save(&self, filename:&Path) {
			let bin: Vec<u8> = bincode::serialize(&self).unwrap();

			let mut file = File::create(filename).unwrap();
			let _result = file.write_all(&bin);
			/*
			// 8 bytes for the length of the vector, 4 bytes per float.
			assert_eq!(encoded.len(), 8 + 4 * 4);

			let decoded: World = bincode::deserialize(&encoded[..]).unwrap();

			assert_eq!(world, decoded);
			*/
		}
		pub fn scaled_down_clone(&self, new_size:usize) -> GeoImage {
			if new_size >= self.size { panic!() }

			let f1 = self.size/new_size;
			let f2 = (f1*f1) as f64;

			let mut clone = GeoImage::new(
				new_size,
				self.zoom,
				self.x_offset,
				self.y_offset
			);

			for y0 in 0..clone.size-1 {
				for x0 in 0..clone.size-1 {
					let mut sum = 0.0f64;
					for yd in 0..f1-1 {
						for xd in 0..f1-1 {
							let index = (y0*f1+yd)*self.size + (x0*f1+xd);
							sum += self.data[index]
						}
					}
					clone.data[y0*clone.size+x0] = sum / f2;
				}
			}

			return clone;
		}
	}



	fn demercator_x(x:f64) -> f64 {
		return x*360.0 - 180.0
	}

	fn demercator_y(y:f64) -> f64 {
		return (((1.0 - y * 2.0) * PI).exp().atan() * 4.0 / PI - 1.0) * 90.0
	}
}
